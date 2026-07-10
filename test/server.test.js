'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/index');

test('serves config, frontend and GeoJSON', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const configResponse = await fetch(`${base}/api/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.mapEpsg, 'EPSG:3857');
  assert.equal(config.dataEpsg, 'EPSG:32653');
  assert.equal(config.zoom, 12);
  assert.equal(config.qgisWmsUrl, '/qgis/wms');
  assert.equal(config.localTilesUrl, '/local-tiles/{z}/{x}/{y}.png');
  assert.equal(config.wmsLayers.yandexRoads, 'Yandex_Roads');
  assert.equal(config.wmsLayers.googleSatellite, 'G_Sat');
  assert.equal(config.wmsLayers.polygon90273, 'polygon_90273');
  assert.equal(config.wfsLayers.polygon90273, 'polygon_90273');

  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="map"/);
  assert.match(html, /id="map-loader"/);
  assert.match(html, /id="island-info-card"/);
  assert.match(html, /id="admin-login-button"/);
  assert.match(html, /id="admin-login-backdrop"/);
  assert.match(html, /id="map-styles-button"/);
  assert.match(html, /id="map-styles-backdrop"/);
  assert.match(html, /id="toggle-local-island-tiles"/);
  assert.match(html, /id="zone-card-backdrop"/);
  assert.match(html, /href="\/vacation-beach-icon\.svg"/);
  assert.match(html, /id="admin-editor-button"/);
  assert.match(html, /src="\/vacation-beach-icon\.svg"/);

  const favicon = await fetch(`${base}/favicon.svg`);
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get('content-type'), /image\/svg\+xml/);

  const logo = await fetch(`${base}/vacation-beach-icon.svg`);
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get('content-type'), /image\/svg\+xml/);

  const forbiddenTransaction = await fetch(`${base}/qgis/wfs`, {
    method:'POST', headers:{'content-type':'text/xml'}, body:'<wfs:Delete />'
  });
  assert.equal(forbiddenTransaction.status, 401);

  const login = await fetch(`${base}/api/admin/login`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({ login:'admin', password:'bigIsland2026' })
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.ok(token);

  const forbiddenAdminTransaction = await fetch(`${base}/qgis/wfs`, {
    method:'POST', headers:{'content-type':'text/xml','x-admin-token':token}, body:'<wfs:Delete />'
  });
  assert.equal(forbiddenAdminTransaction.status, 400);

  const zones = await fetch(`${base}/data/zones.geojson`).then((response) => response.json());
  assert.equal(zones.type, 'FeatureCollection');
  assert.equal(zones.features.length, 3);
});
