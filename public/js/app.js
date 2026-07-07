'use strict';

(async function init() {
  const ui = {
    status: document.querySelector('#qgis-status'), message: document.querySelector('#message'),
    crs: document.querySelector('#crs'), dataCrs: document.querySelector('#data-crs'),
    coordinates: document.querySelector('#coordinates'), zoom: document.querySelector('#zoom'),
    loader: document.querySelector('#map-loader'), islandInfo: document.querySelector('#island-info-card')
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
  let polygonInfoTimer;
  let polygonInfoRequest;
  let polygonInfoTooltip;
  let coordinateFrame;
  let coordinateFadeTimer;
  let loaderHidden = false;

  function hideMapLoader() {
    if (!ui.loader || loaderHidden) return;
    loaderHidden = true;
    ui.loader.classList.add('is-hidden');
    window.setTimeout(() => ui.loader?.remove(), 450);
  }

  layers.basemap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  layers.basemap.once('load', hideMapLoader);
  window.setTimeout(hideMapLoader, 5000);

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
  layers.polygon90273 = createWmsLayer(config.wmsLayers.polygon90273);

  function popup(feature) {
    const props = feature.properties || {};
    const safe = (value) => String(value ?? '—').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return `<strong>${safe(props.name || 'Объект')}</strong><br>Тип: ${safe(props.type)}<br>Источник: ${safe(props.source)}`;
  }

  const semanticLabels = {
    'Тип_объект': 'Тип объекта', 'Код_Тип_об': 'Код типа объекта',
    'Наименован': 'Наименование', 'Ид': 'Идентификатор', 'ОКАТО': 'ОКАТО',
    'ОКТМО': 'ОКТМО', 'Площадь': 'Площадь', 'Код_поселе': 'Код поселения',
    'Почтовый_и': 'Почтовый индекс', 'Родительск': 'Родительский объект',
    'Кто_создал': 'Источник', 'Сведения_д': 'Дополнительные сведения',
    'Уникальный': 'Уникальный код'
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));

  function semanticTable(properties) {
    const rows = Object.entries(properties || {})
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
      .map(([key, value]) => `<tr><th>${escapeHtml(semanticLabels[key] || key.replaceAll('_', ' '))}</th><td>${escapeHtml(value)}</td></tr>`)
      .join('');
    return `<div class="semantic-card"><strong>Семантика зоны</strong><div class="semantic-table-wrap"><table>${rows || '<tr><td>Атрибуты отсутствуют</td></tr>'}</table></div></div>`;
  }

  async function showPolygonInfo(event) {
    if (!map.hasLayer(layers.polygon90273)) return;
    polygonInfoRequest?.abort();
    polygonInfoRequest = new AbortController();
    const size = map.getSize();
    const bounds = map.getBounds();
    const southWest = map.options.crs.project(bounds.getSouthWest());
    const northEast = map.options.crs.project(bounds.getNorthEast());
    const point = map.latLngToContainerPoint(event.latlng);
    const params = new URLSearchParams({
      SERVICE:'WMS', VERSION:'1.3.0', REQUEST:'GetFeatureInfo',
      LAYERS:config.wmsLayers.polygon90273, QUERY_LAYERS:config.wmsLayers.polygon90273,
      INFO_FORMAT:'application/json', FEATURE_COUNT:'1', CRS:'EPSG:3857',
      BBOX:[southWest.x, southWest.y, northEast.x, northEast.y].join(','),
      WIDTH:String(size.x), HEIGHT:String(size.y), I:String(Math.round(point.x)), J:String(Math.round(point.y))
    });
    try {
      const response = await fetch(`${config.qgisWmsUrl}?${params}`, { signal: polygonInfoRequest.signal });
      if (!response.ok) throw new Error(`GetFeatureInfo: HTTP ${response.status}`);
      const feature = (await response.json()).features?.[0];
      if (!feature) {
        if (polygonInfoTooltip) map.removeLayer(polygonInfoTooltip);
        polygonInfoTooltip = null;
        return;
      }
      if (!polygonInfoTooltip) polygonInfoTooltip = L.tooltip({ className:'semantic-tooltip', direction:'right', offset:[14,0] });
      polygonInfoTooltip.setLatLng(event.latlng).setContent(semanticTable(feature.properties)).addTo(map);
    } catch (error) {
      if (error.name !== 'AbortError') ui.message.textContent = 'Не удалось получить семантику polygon_90273.';
    }
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
    const input = document.querySelector(id);
    const option = input.closest('.layer-option');
    option.classList.toggle('active', input.checked);
    input.addEventListener('change', async (event) => {
      ui.message.textContent = '';
      try {
        const layer = loader ? await loader() : layers[key];
        if (event.target.checked) layer.addTo(map);
        else {
          map.removeLayer(layer);
          if (key === 'polygon90273' && polygonInfoTooltip) {
            map.removeLayer(polygonInfoTooltip);
            polygonInfoTooltip = null;
          }
        }
        option.classList.toggle('active', event.target.checked);
      } catch (error) {
        event.target.checked = false;
        option.classList.remove('active');
        ui.message.textContent = error.message;
      }
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
  bindToggle('#toggle-polygon-90273', 'polygon90273');
  bindToggle('#toggle-geojson', 'geojson');
  document.querySelector('#fit-island').addEventListener('click', () => {
    if (typeof map.flyToBounds === 'function') {
      map.flyToBounds(islandBounds, { animate:true, duration:1.5, maxZoom:13 });
    }
    const highlight = L.circle(config.center, {
      radius:6500, color:'#1f765a', weight:4, fillColor:'#64b18f', fillOpacity:.24,
      interactive:false, className:'island-highlight'
    }).addTo(map);
    window.setTimeout(() => map.removeLayer(highlight), 2600);
    ui.islandInfo?.classList.add('is-visible');
    ui.islandInfo?.setAttribute('aria-hidden', 'false');
  });
  document.querySelector('#close-island-info').addEventListener('click', () => {
    ui.islandInfo?.classList.remove('is-visible');
    ui.islandInfo?.setAttribute('aria-hidden', 'true');
  });
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
  map.on('zoomend', updateZoom).on('mousemove', (event) => {
    if (!coordinateFrame) {
      coordinateFrame = window.requestAnimationFrame(() => {
        ui.coordinates.classList.add('is-updating');
        ui.coordinates.textContent = `${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`;
        clearTimeout(coordinateFadeTimer);
        coordinateFadeTimer = window.setTimeout(() => ui.coordinates.classList.remove('is-updating'), 120);
        coordinateFrame = null;
      });
    }
    clearTimeout(polygonInfoTimer);
    if (map.hasLayer(layers.polygon90273)) polygonInfoTimer = setTimeout(() => showPolygonInfo(event), 180);
  }).on('mouseout', () => {
    clearTimeout(polygonInfoTimer);
    polygonInfoRequest?.abort();
    if (polygonInfoTooltip) map.removeLayer(polygonInfoTooltip);
    polygonInfoTooltip = null;
  });
  updateZoom();
  map.whenReady(() => window.setTimeout(hideMapLoader, 900));
  try {
    const params = new URLSearchParams({ SERVICE:'WMS', REQUEST:'GetCapabilities' });
    const ok = (await fetch(`${config.qgisWmsUrl}?${params}`)).ok;
    ui.status.className = `status ${ok ? 'online' : 'offline'}`;
    ui.status.innerHTML = `<span></span>QGIS: ${ok ? 'online' : 'offline'}`;
  } catch { ui.status.className = 'status offline'; ui.status.innerHTML = '<span></span>QGIS: offline'; }
})();
