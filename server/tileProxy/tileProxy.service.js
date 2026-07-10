'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { baseTileSources } = require('./tileSources.config');

const tileCacheDir = path.resolve(process.env.TILE_CACHE_DIR || path.join(__dirname, '..', '..', 'data', 'tile-cache'));
const customSourcesFile = path.resolve(process.env.TILE_CUSTOM_SOURCES_FILE || path.join(__dirname, '..', '..', 'data', 'tile-sources', 'custom-sources.json'));
const offline = String(process.env.TILE_PROXY_OFFLINE || 'false').toLowerCase() === 'true';
const timeoutMs = Number(process.env.TILE_PROXY_TIMEOUT_MS) || 8000;
const maxTileResponseBytes = Number(process.env.MAX_TILE_RESPONSE_BYTES) || 5_000_000;
const maxPrefetchTiles = Number(process.env.MAX_PREFETCH_TILES) || 5000;
const maxPrefetchZoom = Number(process.env.MAX_PREFETCH_ZOOM) || 16;
const allowedTileDomains = new Set((process.env.TILE_ALLOWED_DOMAINS ||
  'tile.openstreetmap.org,mt0.google.com,mt1.google.com,mt2.google.com,mt3.google.com,localhost,127.0.0.1')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean));

const fallbackPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAABmElEQVR4nO3UMQ0AAAgDMMC/5yFjRxMFfXpnZgAA4J0BEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEAABEIDvA3kcAAG7mV79AAAAAElFTkSuQmCC',
  'base64'
);

function contentTypeForExt(ext) {
  const safeExt = String(ext || '').toLowerCase();
  if (safeExt === 'jpg' || safeExt === 'jpeg') return 'image/jpeg';
  if (safeExt === 'webp') return 'image/webp';
  return 'image/png';
}

function sendFallbackTile(res) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(fallbackPng);
}

function sendTileBuffer(res, buffer, ext, cacheHeader = 'public, max-age=31536000, immutable') {
  res.setHeader('Content-Type', contentTypeForExt(ext));
  res.setHeader('Cache-Control', cacheHeader);
  return res.status(200).send(buffer);
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function assertSafeTilePart(value, label) {
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid ${label}`);
}

function getTileLocalPath({ sourceId, z, x, y, ext }) {
  [sourceId, z, x, y].forEach((part, index) => {
    if (index === 0 && !/^[a-zA-Z0-9_-]+$/.test(String(part))) throw new Error('Invalid sourceId');
    if (index > 0) assertSafeTilePart(part, ['z', 'x', 'y'][index - 1]);
  });
  const safeExt = String(ext || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png';
  const resolved = path.resolve(tileCacheDir, sourceId, String(z), String(x), `${y}.${safeExt}`);
  if (!resolved.startsWith(tileCacheDir)) throw new Error('Unsafe tile path');
  return resolved;
}

function getLocalSourceTilePath(source, { z, x, y, ext }) {
  const safeExt = String(ext || source.ext || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png';
  const resolved = path.resolve(source.localDir, String(z), String(x), `${y}.${safeExt}`);
  if (!resolved.startsWith(path.resolve(source.localDir))) throw new Error('Unsafe local source path');
  return resolved;
}

function buildTileUrl(template, { z, x, y }) {
  return template
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y))
    .replaceAll('{s}', 'a');
}

function validateSource(source) {
  if (!source || !source.id || !/^[a-zA-Z0-9_-]+$/.test(source.id)) return false;
  if (source.type !== 'xyz') return false;
  if (!Number.isInteger(Number(source.minZoom)) || !Number.isInteger(Number(source.maxZoom))) return false;
  if (Number(source.minZoom) < 0 || Number(source.maxZoom) > 22 || Number(source.minZoom) > Number(source.maxZoom)) return false;
  if (source.localDir) return true;
  if (!source.url || !/\{x\}/i.test(source.url) || !/\{y\}/i.test(source.url) || !/\{z\}/i.test(source.url)) return false;
  if (!/^(https?:\/\/|\/)/i.test(source.url)) return false;
  if (/^https?:\/\//i.test(source.url)) {
    const host = new URL(source.url).hostname.toLowerCase();
    if (!allowedTileDomains.has(host)) return false;
  }
  return true;
}

async function readCustomSources() {
  try {
    const parsed = JSON.parse(await fs.readFile(customSourcesFile, 'utf8'));
    if (!Array.isArray(parsed)) return {};
    return Object.fromEntries(parsed.filter(validateSource).map((source) => [source.id, source]));
  } catch {
    return {};
  }
}

async function getTileSources() {
  return { ...baseTileSources, ...(await readCustomSources()) };
}

async function saveCustomSource(source) {
  if (!validateSource(source)) {
    const error = new Error('Invalid tile source');
    error.status = 400;
    throw error;
  }
  await fs.mkdir(path.dirname(customSourcesFile), { recursive: true });
  const current = Object.values(await readCustomSources()).filter((item) => item.id !== source.id);
  current.push(source);
  await fs.writeFile(customSourcesFile, JSON.stringify(current, null, 2), 'utf8');
  return source;
}

async function downloadTile(upstreamUrl) {
  const response = await fetch(upstreamUrl, {
    headers: { 'user-agent': 'bigIslandProject/1.0 tile proxy' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > maxTileResponseBytes) throw new Error('Tile response is too large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxTileResponseBytes) throw new Error('Tile response is too large');
  return buffer;
}

async function saveTile(localPath, buffer) {
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, buffer);
}

async function getTile(req, res) {
  const { sourceId, z, x, ext } = req.params;
  const y = req.params.y;
  const sources = await getTileSources();
  const source = sources[sourceId];
  if (!source) return res.status(404).json({ error: 'Tile source not found' });
  if (!validateSource(source)) return res.status(400).json({ error: 'Tile source is invalid' });
  const zoom = Number(z);
  if (!Number.isInteger(zoom) || zoom < Number(source.minZoom) || zoom > Number(source.maxZoom)) {
    return res.status(400).json({ error: 'Invalid zoom' });
  }
  const safeExt = source.ext || ext || 'png';
  const cachePath = getTileLocalPath({ sourceId, z, x, y, ext: safeExt });
  if (await fileExists(cachePath)) {
    console.log(`CACHE HIT  ${sourceId} ${z}/${x}/${y}.${safeExt}`);
    return res.sendFile(cachePath, {
      headers: {
        'Content-Type': contentTypeForExt(safeExt),
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  }
  console.log(`CACHE MISS ${sourceId} ${z}/${x}/${y}.${safeExt}`);
  if (source.localDir) {
    const localSourcePath = getLocalSourceTilePath(source, { z, x, y, ext: safeExt });
    if (await fileExists(localSourcePath)) {
      console.log(`LOCAL HIT  ${sourceId} ${z}/${x}/${y}.${safeExt}`);
      const buffer = await fs.readFile(localSourcePath);
      await saveTile(cachePath, buffer).catch((error) => {
        console.warn(`CACHE SAVE FAILED ${sourceId} ${z}/${x}/${y}.${safeExt}`, error.message);
      });
      return sendTileBuffer(res, buffer, safeExt);
    }
    console.log(`LOCAL MISS ${sourceId} ${z}/${x}/${y}.${safeExt}`);
    return sendFallbackTile(res);
  }
  if (offline) return sendFallbackTile(res);
  try {
    const upstreamUrl = buildTileUrl(source.url, { z, x, y });
    console.log(`FETCH      ${sourceId} ${upstreamUrl}`);
    const buffer = await downloadTile(upstreamUrl);
    await saveTile(cachePath, buffer);
    return sendTileBuffer(res, buffer, safeExt);
  } catch (error) {
    console.error(`ERROR      ${sourceId} ${z}/${x}/${y}.${safeExt}`, error.message);
    return sendFallbackTile(res);
  }
}

function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function latToTileY(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom));
}

async function prefetchTiles(req, res) {
  const { sourceId, bounds, minZoom, maxZoom } = req.body || {};
  const sources = await getTileSources();
  const source = sources[sourceId];
  if (!source) return res.status(404).json({ error: 'Tile source not found' });
  const fromZoom = Math.max(Number(minZoom), Number(source.minZoom));
  const toZoom = Math.min(Number(maxZoom), Number(source.maxZoom), maxPrefetchZoom);
  if (!bounds || !Number.isFinite(fromZoom) || !Number.isFinite(toZoom) || fromZoom > toZoom) {
    return res.status(400).json({ error: 'Invalid prefetch request' });
  }
  const ranges = [];
  let tilesCount = 0;
  for (let z = fromZoom; z <= toZoom; z += 1) {
    const xMin = lonToTileX(Number(bounds.west), z);
    const xMax = lonToTileX(Number(bounds.east), z);
    const yMin = latToTileY(Number(bounds.north), z);
    const yMax = latToTileY(Number(bounds.south), z);
    tilesCount += (xMax - xMin + 1) * (yMax - yMin + 1);
    ranges.push({ z, xMin, xMax, yMin, yMax });
  }
  if (tilesCount > maxPrefetchTiles) {
    return res.status(400).json({ error: 'Too many tiles for prefetch', tilesCount, maxAllowed: maxPrefetchTiles });
  }
  let downloaded = 0;
  let cached = 0;
  for (const range of ranges) {
    for (let x = range.xMin; x <= range.xMax; x += 1) {
      for (let y = range.yMin; y <= range.yMax; y += 1) {
        const cachePath = getTileLocalPath({ sourceId, z:range.z, x, y, ext:source.ext || 'png' });
        if (await fileExists(cachePath)) { cached += 1; continue; }
        if (offline) continue;
        try {
          let buffer;
          if (source.localDir) buffer = await fs.readFile(getLocalSourceTilePath(source, { z:range.z, x, y, ext:source.ext || 'png' }));
          else buffer = await downloadTile(buildTileUrl(source.url, { z:range.z, x, y }));
          await saveTile(cachePath, buffer);
          downloaded += 1;
        } catch {}
      }
    }
  }
  return res.json({ sourceId, tilesCount, cached, downloaded, offline });
}

async function getStats(_req, res) {
  const sources = await getTileSources();
  const result = [];
  let totalTiles = 0;
  let totalBytes = 0;
  for (const sourceId of Object.keys(sources)) {
    let tiles = 0;
    let bytes = 0;
    const root = path.join(tileCacheDir, sourceId);
    async function walk(dir) {
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(fullPath);
        else {
          const stat = await fs.stat(fullPath);
          tiles += 1;
          bytes += stat.size;
        }
      }
    }
    await walk(root);
    totalTiles += tiles;
    totalBytes += bytes;
    result.push({ id: sourceId, tiles, sizeMb: Number((bytes / 1024 / 1024).toFixed(2)) });
  }
  return res.json({ sources: result, totalTiles, totalSizeMb: Number((totalBytes / 1024 / 1024).toFixed(2)) });
}

async function clearCache(req, res) {
  const sourceId = req.params.sourceId;
  const target = sourceId ? path.resolve(tileCacheDir, sourceId) : tileCacheDir;
  if (!target.startsWith(tileCacheDir)) return res.status(400).json({ error: 'Invalid cache target' });
  await fs.rm(target, { recursive: true, force: true });
  return res.json({ ok: true, cleared: sourceId || 'all' });
}

module.exports = {
  getTile,
  getStats,
  clearCache,
  prefetchTiles,
  saveCustomSource,
  getTileSources,
  tileCacheDir,
  sendFallbackTile
};
