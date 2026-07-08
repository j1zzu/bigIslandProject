'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const qgisServerUrl = process.env.QGIS_SERVER_URL ||
  'http://192.168.20.20:8080/cgi-bin/qgis_mapserv.fcgi.exe';
const qgisProjectPath = process.env.QGIS_PROJECT_PATH || 'world2.qgz';
const qgisTimeoutMs = Number(process.env.QGIS_TIMEOUT_MS) || 10000;
const adminLogin = process.env.ADMIN_LOGIN || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'bigIsland2026';
const adminTokens = new Set();

app.disable('x-powered-by');
app.use('/api', express.json({ limit: '32kb' }));

app.get('/api/config', (_req, res) => {
  res.json({
    qgisWmsUrl: '/qgis/wms',
    qgisWfsUrl: '/qgis/wfs',
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

async function proxyQgis(req, res, service) {
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
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
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
