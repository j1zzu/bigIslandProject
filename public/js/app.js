'use strict';

(async function init() {
  const ui = {
    status: document.querySelector('#qgis-status'), message: document.querySelector('#message'),
    crs: document.querySelector('#crs'), dataCrs: document.querySelector('#data-crs'),
    coordinates: document.querySelector('#coordinates'), zoom: document.querySelector('#zoom'),
    loader: document.querySelector('#map-loader'), islandInfo: document.querySelector('#island-info-card'),
    zoneCard: document.querySelector('#zone-card-backdrop'), zoneTitle: document.querySelector('#zone-card-title'),
    zoneBody: document.querySelector('#zone-card-body'), zoneStatus:document.querySelector('#zone-save-status'),
    editZone:document.querySelector('#edit-zone-card'), cancelZone:document.querySelector('#cancel-zone-card'),
    saveZone:document.querySelector('#save-zone-card')
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
  let coordinateFrame;
  let coordinateFadeTimer;
  let loaderHidden = false;
  let islandInfoTimer;
  let activeZoneFeature;

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

  function showZoneCard(feature) {
    const properties = feature.properties || {};
    activeZoneFeature = feature;
    const rows = Object.entries(properties)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
      .map(([key, value]) => {
        return `<tr><th>${escapeHtml(semanticLabels[key] || key.replaceAll('_', ' '))}</th><td><input class="zone-field-input" data-field="${escapeHtml(key)}" value="${escapeHtml(value)}" readonly></td></tr>`;
      })
      .join('');
    ui.zoneTitle.textContent = properties?.Наименован || 'Информация о зоне';
    ui.zoneBody.innerHTML = rows || '<tr><td colspan="2">Заполненные атрибуты отсутствуют</td></tr>';
    ui.zoneStatus.textContent = '';
    ui.zoneStatus.className = 'zone-save-status';
    ui.editZone.hidden = false;
    ui.cancelZone.hidden = true;
    ui.saveZone.hidden = true;
    ui.zoneCard.classList.add('is-visible');
    ui.zoneCard.setAttribute('aria-hidden', 'false');
    document.querySelector('#close-zone-card').focus();
  }

  function hideZoneCard() {
    ui.zoneCard.classList.remove('is-visible');
    ui.zoneCard.setAttribute('aria-hidden', 'true');
  }

  function setZoneEditMode(editing) {
    ui.zoneBody.querySelectorAll('.zone-field-input').forEach((input) => { input.readOnly = !editing; });
    ui.editZone.hidden = editing;
    ui.cancelZone.hidden = !editing;
    ui.saveZone.hidden = !editing;
    ui.zoneStatus.textContent = editing ? 'Измените значения и нажмите «Сохранить».' : '';
  }

  const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'
  }[char]));

  async function saveZoneChanges() {
    if (!activeZoneFeature?.id) {
      ui.zoneStatus.textContent = 'QGIS не передал идентификатор объекта.';
      ui.zoneStatus.className = 'zone-save-status error';
      return;
    }
    const values = [...ui.zoneBody.querySelectorAll('.zone-field-input')].map((input) => ({ name:input.dataset.field, value:input.value }));
    const propertiesXml = values.map(({name,value}) => `<wfs:Property><wfs:Name>${escapeXml(name)}</wfs:Name><wfs:Value>${escapeXml(value)}</wfs:Value></wfs:Property>`).join('');
    const transaction = `<?xml version="1.0" encoding="UTF-8"?><wfs:Transaction service="WFS" version="1.1.0" xmlns:wfs="http://www.opengis.net/wfs" xmlns:ogc="http://www.opengis.net/ogc"><wfs:Update typeName="${escapeXml(config.wfsLayers.polygon90273)}">${propertiesXml}<ogc:Filter><ogc:FeatureId fid="${escapeXml(activeZoneFeature.id)}"/></ogc:Filter></wfs:Update></wfs:Transaction>`;
    ui.saveZone.disabled = true;
    ui.zoneStatus.textContent = 'Сохраняем изменения…';
    ui.zoneStatus.className = 'zone-save-status';
    try {
      const response = await fetch(config.qgisWfsUrl, { method:'POST', headers:{'Content-Type':'text/xml'}, body:transaction });
      const result = await response.text();
      if (!response.ok || /ExceptionReport|ServiceException/i.test(result)) throw new Error(`WFS-T: HTTP ${response.status}`);
      values.forEach(({name,value}) => { activeZoneFeature.properties[name] = value; });
      ui.zoneTitle.textContent = activeZoneFeature.properties.Наименован || 'Информация о зоне';
      setZoneEditMode(false);
      ui.zoneStatus.textContent = 'Изменения сохранены в QGIS.';
      ui.zoneStatus.className = 'zone-save-status success';
    } catch (error) {
      ui.zoneStatus.textContent = `Не удалось сохранить: ${error.message}`;
      ui.zoneStatus.className = 'zone-save-status error';
    } finally { ui.saveZone.disabled = false; }
  }

  function zoneStyle(index) {
    const hue = Math.round((index * 137.508) % 360);
    const saturation = 62 + (index % 3) * 7;
    const lightness = 43 + (index % 2) * 8;
    const color = `hsl(${hue} ${saturation}% ${lightness}%)`;
    return { color, fillColor:color, weight:2, opacity:.9, fillOpacity:.3, className:'zone-hover-animated' };
  }

  async function loadPolygon90273() {
    if (layers.polygon90273) return layers.polygon90273;
    const params = new URLSearchParams({
      SERVICE:'WFS', VERSION:'1.1.0', REQUEST:'GetFeature',
      TYPENAME:config.wfsLayers.polygon90273,
      OUTPUTFORMAT:'application/vnd.geo+json', SRSNAME:'EPSG:4326'
    });
    const response = await fetch(`${config.qgisWfsUrl}?${params}`);
    if (!response.ok) throw new Error(`polygon_90273: HTTP ${response.status}`);
    const data = await response.json();
    const styles = new WeakMap();
    data.features.forEach((feature, index) => styles.set(feature, zoneStyle(index)));
    layers.polygon90273 = L.geoJSON(data, {
      style: (feature) => styles.get(feature),
      onEachFeature: (feature, layer) => {
        const baseStyle = styles.get(feature);
        layer.on('click', () => showZoneCard(feature));
        layer.on('mouseover', () => {
          layer.setStyle({ weight:4, fillOpacity:.55, opacity:1 });
          layer.bringToFront();
        });
        layer.on('mouseout', () => layer.setStyle(baseStyle));
      }
    });
    return layers.polygon90273;
  }

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
  bindToggle('#toggle-polygon-90273', 'polygon90273', loadPolygon90273);
  document.querySelector('#fit-island').addEventListener('click', () => {
    if (typeof map.flyToBounds === 'function') {
      map.flyToBounds(islandBounds, { animate:true, duration:1.5, maxZoom:13 });
    }
    ui.islandInfo?.classList.add('is-visible');
    ui.islandInfo?.setAttribute('aria-hidden', 'false');
    clearTimeout(islandInfoTimer);
    islandInfoTimer = window.setTimeout(() => {
      ui.islandInfo?.classList.remove('is-visible');
      ui.islandInfo?.setAttribute('aria-hidden', 'true');
    }, 5500);
  });
  document.querySelector('#close-island-info').addEventListener('click', () => {
    clearTimeout(islandInfoTimer);
    ui.islandInfo?.classList.remove('is-visible');
    ui.islandInfo?.setAttribute('aria-hidden', 'true');
  });
  document.querySelector('#close-zone-card').addEventListener('click', hideZoneCard);
  ui.editZone.addEventListener('click', () => setZoneEditMode(true));
  ui.cancelZone.addEventListener('click', () => showZoneCard(activeZoneFeature));
  ui.saveZone.addEventListener('click', saveZoneChanges);
  ui.zoneCard.addEventListener('click', (event) => {
    if (event.target === ui.zoneCard) hideZoneCard();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.zoneCard.classList.contains('is-visible')) hideZoneCard();
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
