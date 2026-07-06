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
  const map = L.map('map', {
    center: config.center,
    zoom: config.zoom,
    minZoom: 3,
    maxZoom: 22,
    zoomControl: false
  });
  L.control.zoom({ position: 'bottomleft', zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(map);
  const islandBounds = L.latLngBounds([48.28, 134.62], [48.57, 135.08]);
  const layers = {};

  layers.basemap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  function createWmsLayer(layerName) {
    return L.tileLayer.wms(config.qgisWmsUrl, {
      layers: layerName, format: 'image/png', transparent: true, version: '1.3.0',
      crs: L.CRS.EPSG3857, tiled: true, maxZoom: 22, attribution: 'QGIS Server'
    });
  }
  layers.yandexRoads = createWmsLayer(config.wmsLayers.yandexRoads);
  layers.ortophoto = createWmsLayer(config.wmsLayers.ortophoto);
  layers.yandexSatellite = createWmsLayer(config.wmsLayers.yandexSatellite);
  layers.yandexSatelliteAlt = createWmsLayer(config.wmsLayers.yandexSatelliteAlt);
  layers.mapbox = createWmsLayer(config.wmsLayers.mapbox);
  layers.qgisOsm = createWmsLayer(config.wmsLayers.osm);
  layers.googleSatellite = createWmsLayer(config.wmsLayers.googleSatellite);
  layers.esri = createWmsLayer(config.wmsLayers.esri);

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
  bindToggle('#toggle-yandex-roads', 'yandexRoads');
  bindToggle('#toggle-ortophoto', 'ortophoto');
  bindToggle('#toggle-yandex-satellite', 'yandexSatellite');
  bindToggle('#toggle-yandex-satellite-alt', 'yandexSatelliteAlt');
  bindToggle('#toggle-mapbox', 'mapbox');
  bindToggle('#toggle-qgis-osm', 'qgisOsm');
  bindToggle('#toggle-google-satellite', 'googleSatellite');
  bindToggle('#toggle-esri', 'esri');
  bindToggle('#toggle-geojson', 'geojson');
  document.querySelector('#fit-island').addEventListener('click', () => map.fitBounds(islandBounds));
  const layersPanel = document.querySelector('#layers-panel');
  const layersPanelButton = document.querySelector('#toggle-layers-panel');
  layersPanelButton.addEventListener('click', () => {
    const collapsed = layersPanel.classList.toggle('collapsed');
    layersPanelButton.setAttribute('aria-expanded', String(!collapsed));
    layersPanelButton.setAttribute('aria-label', collapsed ? 'Развернуть меню слоёв' : 'Свернуть меню слоёв');
  });

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
