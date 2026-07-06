'use strict';

const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const qgisServerUrl = process.env.QGIS_SERVER_URL ||
  'http://192.168.20.21/cgi-bin/qgis_mapserv.fcgi';
const qgisProjectPath = process.env.QGIS_PROJECT_PATH || '';
const qgisTimeoutMs = Number(process.env.QGIS_TIMEOUT_MS) || 10000;

app.disable('x-powered-by');

app.get('/api/config', (_req, res) => {
  res.json({
    qgisWmsUrl: '/qgis/wms',
    qgisWfsUrl: '/qgis/wfs',
    mapEpsg: 'EPSG:3857',
    dataEpsg: process.env.DEFAULT_EPSG || 'EPSG:32653',
    defaultEpsg: 'EPSG:3857',
    center: [48.43, 134.85],
    zoom: 11,
    wmsLayers: {
      overlay: 'revit_boundaries',
      revitBoundaries: 'revit_boundaries'
    },
    wfsLayers: {
      zones: 'zones',
      revitBoundaries: 'revit_boundaries'
    }
  });
});

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
      signal: AbortSignal.timeout(qgisTimeoutMs),
      headers: { accept: req.get('accept') || '*/*' }
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
