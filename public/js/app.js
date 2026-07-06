'use strict';

(async function init() {
  const ui = {
    status: document.querySelector('#qgis-status'), message: document.querySelector('#message'),
    crs: document.querySelector('#crs'), dataCrs: document.querySelector('#data-crs'),
    coordinates: document.querySelector('#coordinates'), zoom: document.querySelector('#zoom')
  };
  const config = await fetch('/api/config').then((response) => {
    if (!response.ok) throw new Error('Не удалось загрузить конфигурацию');
    return response.json();
  });
  const map = L.map('map', { center: config.center, zoom: config.zoom });
  const islandBounds = L.latLngBounds([48.28, 134.62], [48.57, 135.08]);
  const layers = {};

  layers.basemap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  layers.wms = L.tileLayer.wms(config.qgisWmsUrl, {
    layers: config.wmsLayers.overlay || config.wmsLayers.revitBoundaries,
    format: 'image/png', transparent: true, version: '1.3.0',
    crs: L.CRS.EPSG3857, tiled: true, attribution: 'QGIS Server'
  });

  function popup(feature) {
    const props = feature.properties || {};
    const safe = (value) => String(value ?? '—').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return `<strong>${safe(props.name || 'Объект')}</strong><br>Тип: ${safe(props.type)}<br>Источник: ${safe(props.source)}`;
  }
  layers.geojson = L.geoJSON(null, {
    style: { color:'#d45f35', weight:2, fillColor:'#ed9d69', fillOpacity:.24 },
    onEachFeature: (feature, layer) => layer.bindPopup(popup(feature))
  }).addTo(map);
  try {
    const response = await fetch('/data/zones.geojson');
    if (!response.ok) throw new Error();
    layers.geojson.addData(await response.json());
  } catch { ui.message.textContent = 'Локальный GeoJSON недоступен.'; }

  async function loadWfs(key, typeName) {
    if (layers[key]) return layers[key];
    const params = new URLSearchParams({ SERVICE:'WFS', VERSION:'1.1.0', REQUEST:'GetFeature', TYPENAME:typeName, OUTPUTFORMAT:'application/json', SRSNAME:'EPSG:4326' });
    const response = await fetch(`${config.qgisWfsUrl}?${params}`);
    if (!response.ok) throw new Error(`WFS ${typeName}: HTTP ${response.status}`);
    const data = await response.json();
    layers[key] = L.geoJSON(data, { style:{ color:'#176d7d', weight:2, fillOpacity:.15 }, onEachFeature:(feature, layer) => layer.bindPopup(popup(feature)) });
    return layers[key];
  }
  function bindToggle(id, key, loader) {
    document.querySelector(id).addEventListener('change', async (event) => {
      ui.message.textContent = '';
      try {
        const layer = loader ? await loader() : layers[key];
        if (event.target.checked) layer.addTo(map); else map.removeLayer(layer);
      } catch (error) { event.target.checked = false; ui.message.textContent = error.message; }
    });
  }
  bindToggle('#toggle-basemap', 'basemap');
  bindToggle('#toggle-wms', 'wms');
  bindToggle('#toggle-geojson', 'geojson');
  bindToggle('#toggle-wfs', 'wfsZones', () => loadWfs('wfsZones', config.wfsLayers.zones));
  bindToggle('#toggle-boundaries', 'wfsBoundaries', () => loadWfs('wfsBoundaries', config.wfsLayers.revitBoundaries));
  document.querySelector('#fit-island').addEventListener('click', () => map.fitBounds(islandBounds));

  ui.crs.textContent = config.mapEpsg || 'EPSG:3857';
  ui.dataCrs.textContent = config.dataEpsg || 'EPSG:32653';
  const updateZoom = () => { ui.zoom.textContent = map.getZoom(); };
  map.on('zoomend', updateZoom).on('mousemove', ({latlng}) => { ui.coordinates.textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`; });
  updateZoom();
  try {
    const params = new URLSearchParams({ SERVICE:'WMS', REQUEST:'GetCapabilities' });
    const ok = (await fetch(`${config.qgisWmsUrl}?${params}`)).ok;
    ui.status.className = `status ${ok ? 'online' : 'offline'}`;
    ui.status.innerHTML = `<span></span>QGIS: ${ok ? 'online' : 'offline'}`;
  } catch { ui.status.className = 'status offline'; ui.status.innerHTML = '<span></span>QGIS: offline'; }
})();
