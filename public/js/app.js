'use strict';

(async function init() {
  const ui = {
    status: document.querySelector('#qgis-status'), message: document.querySelector('#message'),
    crs: document.querySelector('#crs'), dataCrs: document.querySelector('#data-crs'),
    coordinates: document.querySelector('#coordinates'), zoom: document.querySelector('#zoom'),
    loader: document.querySelector('#map-loader'), islandInfo: document.querySelector('#island-info-card'),
    islandBackdrop:document.querySelector('#island-info-backdrop'),
    zoneCard: document.querySelector('#zone-card-backdrop'), zoneTitle: document.querySelector('#zone-card-title'),
    zoneBody: document.querySelector('#zone-card-body'), zoneStatus:document.querySelector('#zone-save-status'),
    editZone:document.querySelector('#edit-zone-card'), cancelZone:document.querySelector('#cancel-zone-card'),
    saveZone:document.querySelector('#save-zone-card'),
    adminButton:document.querySelector('#admin-login-button'), adminBackdrop:document.querySelector('#admin-login-backdrop'),
    adminForm:document.querySelector('#admin-login-form'), adminName:document.querySelector('#admin-name'),
    adminPassword:document.querySelector('#admin-password'), adminStatus:document.querySelector('#admin-login-status'),
    adminDropdown:document.querySelector('#admin-dropdown'), adminLogout:document.querySelector('#admin-logout-button'),
    stylesButton:document.querySelector('#map-styles-button'), stylesBackdrop:document.querySelector('#map-styles-backdrop'),
    stylesClose:document.querySelector('#close-map-styles')
  };
  let adminToken = sessionStorage.getItem('bigIslandAdminToken') || '';
  let adminDisplayName = sessionStorage.getItem('bigIslandAdminName') || '';
  let isAdmin = Boolean(adminToken);
  const config = await fetch('/api/config').then((response) => {
    if (!response.ok) throw new Error('Не удалось загрузить конфигурацию');
    return response.json();
  });
  const islandBounds = L.latLngBounds([48.26, 134.59], [48.505, 135.20]);
  const map = L.map('map', {
    center: config.center,
    zoom: config.zoom,
    minZoom: 12,
    maxZoom: 22,
    maxBounds:islandBounds,
    maxBoundsViscosity:1,
    zoomControl: false
  });
  map.attributionControl.setPrefix('');
  const mapContainer = map.getContainer();
  const mapStyleClasses = ['map-style-default','map-style-light','map-style-muted','map-style-night','map-style-nature','map-style-contrast','map-style-minimal'];
  const savedMapStyle = localStorage.getItem('bigIslandMapStyle') || 'default';
  const cursorIndicator = document.createElement('div');
  cursorIndicator.className = 'map-cursor-indicator';
  mapContainer.appendChild(cursorIndicator);
  map.on('dragend zoomend moveend', () => {
    map.panInsideBounds(islandBounds, { animate: true });
  });
  L.control.zoom({ position: 'bottomleft', zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(map);
  const layers = {};
  let coordinateFrame;
  let coordinateFadeTimer;
  let loaderHidden = false;
  let activeZoneFeature;

  function updateAdminUi() {
    ui.adminButton.classList.toggle('is-admin', isAdmin);
    ui.status.classList.toggle('admin-visible', isAdmin);
    ui.adminButton.querySelector('span:last-child').textContent = isAdmin ? (adminDisplayName || 'Администратор') : 'Вход';
    ui.adminButton.setAttribute('aria-label', isAdmin ? `Администратор ${adminDisplayName || ''}`.trim() : 'Вход');
    if (!isAdmin) {
      ui.adminDropdown.classList.remove('is-visible');
      ui.adminDropdown.setAttribute('aria-hidden', 'true');
    }
    if (ui.zoneCard.classList.contains('is-visible') && activeZoneFeature) showZoneCard(activeZoneFeature);
  }

  function setQgisStatus(online) {
    ui.status.className = `status ${online ? 'online' : 'offline'}${isAdmin ? ' admin-visible' : ''}`;
    ui.status.innerHTML = `<span></span>QGIS: ${online ? 'online' : 'offline'}`;
  }

  function toggleAdminDropdown() {
    const visible = ui.adminDropdown.classList.toggle('is-visible');
    ui.adminDropdown.setAttribute('aria-hidden', String(!visible));
  }

  function logoutAdmin() {
    isAdmin = false;
    adminToken = '';
    adminDisplayName = '';
    sessionStorage.removeItem('bigIslandAdminToken');
    sessionStorage.removeItem('bigIslandAdminName');
    setZoneEditMode(false);
    updateAdminUi();
  }

  function showAdminModal() {
    ui.adminStatus.textContent = isAdmin ? 'Вы уже вошли как администратор.' : '';
    ui.adminStatus.className = 'admin-login-status';
    ui.adminForm.reset();
    ui.adminBackdrop.classList.add('is-visible');
    ui.adminBackdrop.setAttribute('aria-hidden', 'false');
    window.setTimeout(() => ui.adminName.focus(), 80);
  }

  function hideAdminModal() {
    ui.adminBackdrop.classList.remove('is-visible');
    ui.adminBackdrop.setAttribute('aria-hidden', 'true');
  }

  function hideMapLoader() {
    if (!ui.loader || loaderHidden) return;
    loaderHidden = true;
    ui.loader.classList.add('is-hidden');
    window.setTimeout(() => ui.loader?.remove(), 450);
  }

  function applyMapStyle(styleName) {
    const safeStyle = ['default','light','muted','night','nature','contrast','minimal'].includes(styleName) ? styleName : 'default';
    mapContainer.classList.remove(...mapStyleClasses);
    mapContainer.classList.add(`map-style-${safeStyle}`);
    localStorage.setItem('bigIslandMapStyle', safeStyle);
    document.querySelectorAll('.map-style-card').forEach((card) => {
      card.classList.toggle('is-active', card.dataset.mapStyle === safeStyle);
    });
  }

  function showStylesModal() {
    ui.stylesBackdrop.classList.add('is-visible');
    ui.stylesBackdrop.setAttribute('aria-hidden', 'false');
    window.setTimeout(() => ui.stylesClose.focus(), 80);
  }

  function hideStylesModal() {
    ui.stylesBackdrop.classList.remove('is-visible');
    ui.stylesBackdrop.setAttribute('aria-hidden', 'true');
  }

  function createMapClickRipple(event) {
    if (event.originalEvent?.button !== 0) return;
    const point = map.mouseEventToContainerPoint(event.originalEvent);
    const ripple = document.createElement('div');
    ripple.className = 'map-click-ripple';
    ripple.style.left = `${point.x}px`;
    ripple.style.top = `${point.y}px`;
    mapContainer.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 520);
  }

  function moveCursorIndicator(event) {
    const point = map.mouseEventToContainerPoint(event.originalEvent);
    cursorIndicator.style.left = `${point.x}px`;
    cursorIndicator.style.top = `${point.y}px`;
    cursorIndicator.classList.add('is-visible');
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
  applyMapStyle(savedMapStyle);

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
        const locked = key === 'Ид';
        return `<tr><th>${escapeHtml(semanticLabels[key] || key.replaceAll('_', ' '))}</th><td><input class="zone-field-input" data-field="${escapeHtml(key)}"${locked ? ' data-locked="true" title="Идентификатор изменять нельзя"' : ''} value="${escapeHtml(value)}" readonly></td></tr>`;
      })
      .join('');
    ui.zoneTitle.textContent = properties?.Наименован || 'Информация о зоне';
    ui.zoneBody.innerHTML = rows || '<tr><td colspan="2">Заполненные атрибуты отсутствуют</td></tr>';
    ui.zoneStatus.textContent = isAdmin ? '' : 'Редактирование доступно только администратору.';
    ui.zoneStatus.className = 'zone-save-status';
    ui.editZone.hidden = !isAdmin;
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
    if (editing && !isAdmin) {
      ui.zoneStatus.textContent = 'Сначала войдите как администратор.';
      ui.zoneStatus.className = 'zone-save-status error';
      showAdminModal();
      return;
    }
    ui.zoneBody.querySelectorAll('.zone-field-input').forEach((input) => {
      input.readOnly = !editing || input.dataset.locked === 'true';
    });
    ui.editZone.hidden = editing;
    ui.cancelZone.hidden = !editing;
    ui.saveZone.hidden = !editing;
    ui.zoneStatus.textContent = editing ? 'Измените значения и нажмите «Сохранить».' : '';
  }

  const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'
  }[char]));

  async function saveZoneChanges() {
    if (!isAdmin) {
      ui.zoneStatus.textContent = 'Сохранять изменения может только администратор.';
      ui.zoneStatus.className = 'zone-save-status error';
      showAdminModal();
      return;
    }
    if (!activeZoneFeature?.id) {
      ui.zoneStatus.textContent = 'QGIS не передал идентификатор объекта.';
      ui.zoneStatus.className = 'zone-save-status error';
      return;
    }
    const values = [...ui.zoneBody.querySelectorAll('.zone-field-input:not([data-locked="true"])')].map((input) => ({ name:input.dataset.field, value:input.value }));
    const propertiesXml = values.map(({name,value}) => `<wfs:Property><wfs:Name>${escapeXml(name)}</wfs:Name><wfs:Value>${escapeXml(value)}</wfs:Value></wfs:Property>`).join('');
    const transaction = `<?xml version="1.0" encoding="UTF-8"?><wfs:Transaction service="WFS" version="1.1.0" xmlns:wfs="http://www.opengis.net/wfs" xmlns:ogc="http://www.opengis.net/ogc"><wfs:Update typeName="${escapeXml(config.wfsLayers.polygon90273)}">${propertiesXml}<ogc:Filter><ogc:FeatureId fid="${escapeXml(activeZoneFeature.id)}"/></ogc:Filter></wfs:Update></wfs:Transaction>`;
    ui.saveZone.disabled = true;
    ui.zoneStatus.textContent = 'Сохраняем изменения…';
    ui.zoneStatus.className = 'zone-save-status';
    try {
      const response = await fetch(config.qgisWfsUrl, { method:'POST', headers:{'Content-Type':'text/xml','X-Admin-Token':adminToken}, body:transaction });
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

  const toggleRegistry = [];

  function bindToggle(id, key, loader) {
    const input = document.querySelector(id);
    const option = input.closest('.layer-option');
    toggleRegistry.push({ input, option, key });
    option.classList.toggle('active', input.checked);
    input.addEventListener('change', async (event) => {
      ui.message.textContent = '';
      try {
        const layer = loader ? await loader() : layers[key];
        if (event.target.checked) {
          const group = event.target.dataset.exclusiveGroup;
          toggleRegistry.forEach((item) => {
            if (item.input !== event.target && item.input.dataset.exclusiveGroup === group) {
              item.input.checked = false;
              item.option.classList.remove('active');
              const otherLayer = layers[item.key];
              if (otherLayer && map.hasLayer(otherLayer)) map.removeLayer(otherLayer);
            }
          });
          layer.addTo(map);
        }
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
  ui.stylesButton.addEventListener('click', showStylesModal);
  ui.stylesClose.addEventListener('click', hideStylesModal);
  ui.stylesBackdrop.addEventListener('click', (event) => {
    if (event.target === ui.stylesBackdrop) hideStylesModal();
  });
  document.querySelectorAll('.map-style-card').forEach((card) => {
    card.addEventListener('click', () => {
      applyMapStyle(card.dataset.mapStyle);
      hideStylesModal();
    });
  });
  updateAdminUi();
  ui.adminButton.addEventListener('click', () => {
    if (isAdmin) toggleAdminDropdown();
    else showAdminModal();
  });
  ui.adminLogout.addEventListener('click', logoutAdmin);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.admin-menu-wrap')) {
      ui.adminDropdown.classList.remove('is-visible');
      ui.adminDropdown.setAttribute('aria-hidden', 'true');
    }
  });
  document.querySelector('#close-admin-login').addEventListener('click', hideAdminModal);
  ui.adminBackdrop.addEventListener('click', (event) => {
    if (event.target === ui.adminBackdrop) hideAdminModal();
  });
  ui.adminForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const login = ui.adminName.value.trim();
    const password = ui.adminPassword.value;
    ui.adminStatus.textContent = 'Проверяем доступ…';
    ui.adminStatus.className = 'admin-login-status';
    fetch('/api/admin/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ login, password })
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Неверный логин или пароль.');
      adminToken = data.token;
      adminDisplayName = login;
      isAdmin = true;
      sessionStorage.setItem('bigIslandAdminToken', adminToken);
      sessionStorage.setItem('bigIslandAdminName', adminDisplayName);
      ui.adminStatus.textContent = 'Вход выполнен. Теперь редактирование зон доступно.';
      ui.adminStatus.className = 'admin-login-status success';
      updateAdminUi();
      window.setTimeout(hideAdminModal, 900);
    }).catch(() => {
      isAdmin = false;
      adminToken = '';
      adminDisplayName = '';
      sessionStorage.removeItem('bigIslandAdminToken');
      sessionStorage.removeItem('bigIslandAdminName');
      ui.adminStatus.textContent = 'Неверный логин или пароль.';
      ui.adminStatus.className = 'admin-login-status error';
      updateAdminUi();
    });
  });
  document.querySelector('#show-island-description').addEventListener('click', () => {
    ui.islandBackdrop.classList.add('is-visible');
    ui.islandBackdrop.setAttribute('aria-hidden', 'false');
    document.querySelector('#close-island-info').focus();
  });
  const hideIslandInfo = () => {
    ui.islandBackdrop.classList.remove('is-visible');
    ui.islandBackdrop.setAttribute('aria-hidden', 'true');
  };
  document.querySelector('#close-island-info').addEventListener('click', hideIslandInfo);
  ui.islandBackdrop.addEventListener('click', (event) => {
    if (event.target === ui.islandBackdrop) hideIslandInfo();
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
    if (event.key === 'Escape' && ui.islandBackdrop.classList.contains('is-visible')) hideIslandInfo();
    if (event.key === 'Escape' && ui.adminBackdrop.classList.contains('is-visible')) hideAdminModal();
    if (event.key === 'Escape' && ui.stylesBackdrop.classList.contains('is-visible')) hideStylesModal();
  });
  const layersPanel = document.querySelector('#layers-panel');
  const layersPanelButton = document.querySelector('#toggle-layers-panel');
  layersPanelButton.addEventListener('click', () => {
    const collapsed = layersPanel.classList.toggle('collapsed');
    layersPanelButton.setAttribute('aria-expanded', String(!collapsed));
    layersPanelButton.setAttribute('aria-label', collapsed ? 'Развернуть меню слоёв' : 'Свернуть меню слоёв');
  });
  document.querySelectorAll('.layer-group-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const group = button.closest('.layer-group');
      const expanded = group.classList.toggle('expanded');
      button.setAttribute('aria-expanded', String(expanded));
    });
  });

  ui.crs.textContent = config.mapEpsg || 'EPSG:3857';
  ui.dataCrs.textContent = config.dataEpsg || 'EPSG:32653';
  const updateZoom = () => { ui.zoom.textContent = map.getZoom(); };
  map.on('zoomend', updateZoom).on('mousemove', (event) => {
    moveCursorIndicator(event);
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
  map.on('mouseout', () => cursorIndicator.classList.remove('is-visible'));
  map.on('dragstart', () => {
    mapContainer.classList.add('map-is-dragging');
    cursorIndicator.classList.add('is-dragging');
  });
  map.on('dragend', () => {
    mapContainer.classList.remove('map-is-dragging');
    cursorIndicator.classList.remove('is-dragging');
  });
  map.on('click', createMapClickRipple);
  updateZoom();
  map.whenReady(() => window.setTimeout(hideMapLoader, 900));
  try {
    const params = new URLSearchParams({ SERVICE:'WMS', REQUEST:'GetCapabilities' });
    const ok = (await fetch(`${config.qgisWmsUrl}?${params}`)).ok;
    setQgisStatus(ok);
  } catch { setQgisStatus(false); }
})();
