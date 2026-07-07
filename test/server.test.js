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
  assert.equal(config.qgisWmsUrl, '/qgis/wms');
  assert.equal(config.wmsLayers.yandexRoads, 'Yandex_Roads');
  assert.equal(config.wmsLayers.googleSatellite, 'G_Sat');
  assert.equal(config.wmsLayers.polygon90273, 'polygon_90273');

  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="map"/);
  assert.match(html, /id="map-loader"/);
  assert.match(html, /id="island-info-card"/);

  const zones = await fetch(`${base}/data/zones.geojson`).then((response) => response.json());
  assert.equal(zones.type, 'FeatureCollection');
  assert.equal(zones.features.length, 3);
});
