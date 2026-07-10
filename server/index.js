'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const dotenv = require('dotenv');
const { createTileProxyRouter } = require('./tileProxy/tileProxy.routes');

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const qgisServerUrl = process.env.QGIS_SERVER_URL ||
  'http://192.168.20.20:8080/cgi-bin/qgis_mapserv.fcgi.exe';
const qgisProjectPath = process.env.QGIS_PROJECT_PATH || 'world2.qgz';
const qgisTimeoutMs = Number(process.env.QGIS_TIMEOUT_MS) || 10000;
const localTilesDir = process.env.LOCAL_TILES_DIR || 'C:\\island_imgs\\tile';
const wmsCacheDir = path.resolve(process.env.WMS_CACHE_DIR || path.join(__dirname, '..', 'data', 'wms-cache'));
const adminLogin = process.env.ADMIN_LOGIN || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'bigIsland2026';
const adminTokens = new Set();

app.disable('x-powered-by');
app.use('/api', express.json({ limit: '32kb' }));

app.get('/api/config', (_req, res) => {
  res.json({
    qgisWmsUrl: '/qgis/wms',
    qgisWfsUrl: '/qgis/wfs',
    localTilesUrl: '/local-tiles/{z}/{x}/{y}.png',
    tileProxyUrl: '/api/tiles/{sourceId}/{z}/{x}/{y}.{ext}',
    tileProxySources: {
      osm: '/api/tiles/osm/{z}/{x}/{y}.png',
      googleRoads: '/api/tiles/googleRoads/{z}/{x}/{y}.png',
      googleSatellite: '/api/tiles/googleSatellite/{z}/{x}/{y}.jpg',
      localIslandTiles: '/api/tiles/localIslandTiles/{z}/{x}/{y}.png'
    },
    mapEpsg: 'EPSG:3857',
    dataEpsg: process.env.DEFAULT_EPSG || 'EPSG:32653',
    defaultEpsg: 'EPSG:3857',
    center: [48.38020, 134.89391],
    zoom: 12,
    wmsLayers: {
      yandexRoads: 'Yandex_Roads',
      ortophoto: 'Ortophoto',
      yandexSatellite: 'YA_SAT_zoom22',
      yandexSatelliteAlt: 'YA_SA',
      mapbox: 'MAPBOX',
      osm: 'OSM',
      googleSatellite: 'G_Sat',
      esri: 'Esri',
      polygon90273: 'polygon_90273'
    },
    wfsLayers: {
      polygon90273: 'polygon_90273'
    }
  });
});

app.post('/api/admin/login', (req, res) => {
  const { login, password } = req.body || {};
  if (login !== adminLogin || password !== adminPassword) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.add(token);
  return res.json({ token, name: login });
});

function isAdminRequest(req) {
  const token = req.get('x-admin-token');
  return Boolean(token && adminTokens.has(token));
}

app.use('/api/tiles', createTileProxyRouter({ isAdminRequest }));

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function getQueryParam(query, name) {
  const entry = Object.entries(query).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (!entry) return '';
  return Array.isArray(entry[1]) ? entry[1].join(',') : String(entry[1] ?? '');
}

function sanitizeCacheSegment(value, fallback = 'default') {
  const safe = String(value || fallback)
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return safe || fallback;
}

function imageExtFromQuery(query) {
  const format = getQueryParam(query, 'FORMAT').toLowerCase();
  if (format.includes('jpeg') || format.includes('jpg')) return 'jpg';
  if (format.includes('webp')) return 'webp';
  return 'png';
}

function contentTypeForImageExt(ext) {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
}

function getWmsCacheInfo(query) {
  const requestType = getQueryParam(query, 'REQUEST') || 'GetMap';
  if (requestType.toLowerCase() !== 'getmap') return null;
  const layers = getQueryParam(query, 'LAYERS');
  if (!layers) return null;

  const normalizedEntries = Object.entries({
    ...query,
    SERVICE: 'WMS',
    MAP: getQueryParam(query, 'MAP') || qgisProjectPath || ''
  })
    .flatMap(([key, value]) => (Array.isArray(value)
      ? value.map((item) => [key.toUpperCase(), String(item)])
      : [[key.toUpperCase(), String(value ?? '')]]))
    .sort(([aKey, aValue], [bKey, bValue]) => `${aKey}=${aValue}`.localeCompare(`${bKey}=${bValue}`));

  const cacheKey = normalizedEntries.map(([key, value]) => `${key}=${value}`).join('&');
  const hash = crypto.createHash('sha1').update(cacheKey).digest('hex');
  const layerDir = sanitizeCacheSegment(layers);
  const ext = imageExtFromQuery(query);
  return {
    layerDir,
    ext,
    hash,
    path: path.join(wmsCacheDir, layerDir, `${hash}.${ext}`)
  };
}

async function proxyQgis(req, res, service) {
  const wmsCache = service === 'WMS' && req.method === 'GET' ? getWmsCacheInfo(req.query) : null;
  if (wmsCache && await fileExists(wmsCache.path)) {
    console.log(`WMS CACHE HIT  ${wmsCache.layerDir} ${wmsCache.hash}.${wmsCache.ext}`);
    return res.sendFile(wmsCache.path, {
      headers: {
        'Content-Type': contentTypeForImageExt(wmsCache.ext),
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  }
  if (wmsCache) console.log(`WMS CACHE MISS ${wmsCache.layerDir} ${wmsCache.hash}.${wmsCache.ext}`);

  const target = new URL(qgisServerUrl);
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) value.forEach((item) => target.searchParams.append(key, item));
    else if (value !== undefined) target.searchParams.set(key, value);
  }
  target.searchParams.set('SERVICE', service);
  if (qgisProjectPath && !target.searchParams.has('MAP')) {
    target.searchParams.set('MAP', qgisProjectPath);
  }

  try {
    const response = await fetch(target, {
      method: req.method,
      signal: AbortSignal.timeout(qgisTimeoutMs),
      headers: {
        accept: req.get('accept') || '*/*',
        ...(req.method === 'POST' ? { 'content-type': req.get('content-type') || 'text/xml' } : {})
      },
      body: req.method === 'POST' ? req.body : undefined
    });
    res.status(response.status);
    ['content-type', 'cache-control', 'etag', 'last-modified'].forEach((header) => {
      const value = response.headers.get(header);
      if (value) res.set(header, value);
    });
    const contentType = response.headers.get('content-type') || '';
    const body = Buffer.from(await response.arrayBuffer());
    if (wmsCache && response.ok && contentType.toLowerCase().startsWith('image/')) {
      await fs.mkdir(path.dirname(wmsCache.path), { recursive: true });
      await fs.writeFile(wmsCache.path, body);
      console.log(`WMS CACHE SAVE ${wmsCache.layerDir} ${wmsCache.hash}.${wmsCache.ext}`);
    }
    res.send(body);
  } catch (error) {
    if (wmsCache && await fileExists(wmsCache.path)) {
      console.log(`WMS CACHE HIT  ${wmsCache.layerDir} ${wmsCache.hash}.${wmsCache.ext}`);
      return res.sendFile(wmsCache.path, {
        headers: {
          'Content-Type': contentTypeForImageExt(wmsCache.ext),
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }
    const timedOut = error.name === 'TimeoutError';
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'QGIS Server request timed out' : 'QGIS Server is unavailable'
    });
  }
}

app.get('/qgis/wms', (req, res) => proxyQgis(req, res, 'WMS'));
app.get('/qgis/wfs', (req, res) => proxyQgis(req, res, 'WFS'));
app.post('/qgis/wfs', express.text({ type:['text/xml','application/xml'], limit:'1mb' }), (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error:'Admin login is required for WFS updates' });
  }
  const transaction = typeof req.body === 'string' ? req.body : '';
  const updatesPolygon = /<wfs:Update\s+typeName="polygon_90273"/i.test(transaction);
  const containsForbiddenOperation = /<wfs:(?:Insert|Delete)\b/i.test(transaction);
  if (!updatesPolygon || containsForbiddenOperation) {
    return res.status(400).json({ error:'Only polygon_90273 WFS updates are allowed' });
  }
  return proxyQgis(req, res, 'WFS');
});
app.use('/local-tiles', express.static(localTilesDir, {
  fallthrough: true,
  immutable: true,
  maxAge: '1d'
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

if (require.main === module) {
  const url = `http://localhost:${port}`;
  const server = app.listen(port, async () => {
    console.log(`Сайт запущен: ${url}`);
    console.log('Для остановки нажмите Ctrl+C.');

    if (process.argv.includes('--open')) {
      const { default: open } = await import('open');
      await open(url);
    }
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      console.error(`Порт ${port} уже занят. Откройте ${url} или остановите старый сервер сочетанием Ctrl+C.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
}

module.exports = app;
