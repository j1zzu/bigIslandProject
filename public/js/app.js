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
    adminEditor:document.querySelector('#admin-editor-button'),
    stylesButton:document.querySelector('#map-styles-button'), stylesBackdrop:document.querySelector('#map-styles-backdrop'),
    stylesClose:document.querySelector('#close-map-styles'),
    createLayerButton:document.querySelector('#create-layer-button'), createLayerBackdrop:document.querySelector('#create-layer-backdrop'),
    createLayerForm:document.querySelector('#create-layer-form'), createLayerClose:document.querySelector('#close-create-layer'),
    createLayerCancel:document.querySelector('#cancel-create-layer'), createLayerSubmit:document.querySelector('#submit-create-layer'),
    createLayerStatus:document.querySelector('#create-layer-status'),
    mapsLayerList:document.querySelector('#maps-layer-list'), zonesLayerList:document.querySelector('#zones-layer-list'),
    customProvider:document.querySelector('#custom-layer-provider'), customName:document.querySelector('#custom-layer-name'),
    customGroup:document.querySelector('#custom-layer-group'), customType:document.querySelector('#custom-layer-type'), customUrl:document.querySelector('#custom-layer-url'),
    customMinZoom:document.querySelector('#custom-layer-minzoom'), customMaxZoom:document.querySelector('#custom-layer-maxzoom'),
    customAttribution:document.querySelector('#custom-layer-attribution'), customWmsFields:document.querySelector('#custom-layer-wms-fields'),
    customWmsLayers:document.querySelector('#custom-layer-wms-layers'), customWmsStyles:document.querySelector('#custom-layer-wms-styles'),
    customWmsFormat:document.querySelector('#custom-layer-wms-format'), customWmsVersion:document.querySelector('#custom-layer-wms-version'),
    customTransparent:document.querySelector('#custom-layer-transparent'),
    editorBackdrop:document.querySelector('#editor-backdrop'), editorClose:document.querySelector('#close-editor'),
    editorTitle:document.querySelector('#editor-title'), editorDescription:document.querySelector('#editor-description'),
    editorModeView:document.querySelector('#editor-mode-view'), zoneEditorView:document.querySelector('#zone-editor-view'),
    layerEditorView:document.querySelector('#layer-editor-view'), layerEditorList:document.querySelector('#layer-editor-list'),
    openZoneEditor:document.querySelector('#open-zone-editor'), openLayerEditor:document.querySelector('#open-layer-editor'),
    backFromZoneEditor:document.querySelector('#back-from-zone-editor'), backFromLayerEditor:document.querySelector('#back-from-layer-editor')
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
  map.createPane('baseMapsPane');
  map.createPane('islandTilesPane');
  map.createPane('zonesPane');
  map.getPane('baseMapsPane').style.zIndex = 200;
  map.getPane('islandTilesPane').style.zIndex = 450;
  map.getPane('zonesPane').style.zIndex = 850;
  map.getPane('baseMapsPane').style.pointerEvents = 'none';
  map.getPane('islandTilesPane').style.pointerEvents = 'none';
  map.getPane('zonesPane').style.pointerEvents = 'auto';
  const zonesRenderer = L.svg({ pane:'zonesPane' });
  const mapStyleClasses = ['map-style-default','map-style-light','map-style-muted','map-style-nature','map-style-contrast','map-style-minimal','map-style-amur-mist','map-style-emerald-island'];
  const savedMapStyle = localStorage.getItem('bigIslandMapStyle') === 'night' ? 'default' : (localStorage.getItem('bigIslandMapStyle') || 'default');
  const cursorIndicator = document.createElement('div');
  cursorIndicator.className = 'map-cursor-indicator';
  mapContainer.appendChild(cursorIndicator);
  let boundsFrame;
  function keepMapInsideBounds() {
    if (boundsFrame) return;
    boundsFrame = window.requestAnimationFrame(() => {
      boundsFrame = null;
      map.panInsideBounds(islandBounds, { animate: false });
    });
  }
  map.on('dragend zoomend', keepMapInsideBounds);
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(map);
  const layers = {};
  const customLayers = [];
  const CUSTOM_LAYERS_KEY = 'customMapLayers';
  let coordinateFrame;
  let coordinateFadeTimer;
  let loaderHidden = false;
  let activeZoneFeature;
  let editingCustomLayerId = '';

  function updateAdminUi() {
    ui.adminButton.classList.toggle('is-admin', isAdmin);
    ui.status.classList.toggle('admin-visible', isAdmin);
    ui.adminButton.querySelector('span:last-child').textContent = isAdmin ? (adminDisplayName || 'Администратор') : 'Вход';
    ui.adminButton.setAttribute('aria-label', isAdmin ? `Администратор ${adminDisplayName || ''}`.trim() : 'Вход');
    if (!isAdmin) {
      ui.adminDropdown.classList.remove('is-visible');
      ui.adminDropdown.setAttribute('aria-hidden', 'true');
    }
    ui.createLayerButton.hidden = !isAdmin;
    ui.adminEditor.hidden = !isAdmin;
    renderCustomLayers();
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

  function closeAdminDropdown() {
    ui.adminDropdown.classList.remove('is-visible');
    ui.adminDropdown.setAttribute('aria-hidden', 'true');
  }

  function openAdminEditor() {
    closeAdminDropdown();
    showEditorModal();
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
    const safeStyle = ['default','light','muted','nature','contrast','minimal','amur-mist','emerald-island'].includes(styleName) ? styleName : 'default';
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
    pane:'baseMapsPane',
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  const localTileBounds = {
    13:{minX:7161,maxX:7171,minY:2831,maxY:2840},
    14:{minX:14323,maxX:14342,minY:5662,maxY:5680},
    15:{minX:28646,maxX:28685,minY:11324,maxY:11360},
    16:{minX:57292,maxX:57371,minY:22648,maxY:22721},
    17:{minX:114584,maxX:114743,minY:45296,maxY:45442},
    18:{minX:229169,maxX:229486,minY:90593,maxY:90884}
  };
  const FeatheredTileLayer = L.TileLayer.extend({
    createTile(coords, done) {
      const bounds = localTileBounds[coords.z];
      const edges = bounds ? {
        left:coords.x === bounds.minX,
        right:coords.x === bounds.maxX,
        top:coords.y === bounds.minY,
        bottom:coords.y === bounds.maxY
      } : {};
      const needsFeather = edges.left || edges.right || edges.top || edges.bottom;
      if (!needsFeather) return L.TileLayer.prototype.createTile.call(this, coords, done);
      const canvas = document.createElement('canvas');
      const size = this.getTileSize();
      canvas.width = size.x;
      canvas.height = size.y;
      const image = document.createElement('img');
      image.alt = '';
      image.onload = () => {
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, size.x, size.y);
        context.globalCompositeOperation = 'destination-in';
        const feather = Math.min(54, Math.round(size.x * 0.22));
        const applyMask = (gradient) => {
          context.fillStyle = gradient;
          context.fillRect(0, 0, size.x, size.y);
        };
        if (edges.left) {
          const gradient = context.createLinearGradient(0, 0, feather, 0);
          gradient.addColorStop(0, 'rgba(0,0,0,0)');
          gradient.addColorStop(1, 'rgba(0,0,0,1)');
          applyMask(gradient);
        }
        if (edges.right) {
          const gradient = context.createLinearGradient(size.x, 0, size.x - feather, 0);
          gradient.addColorStop(0, 'rgba(0,0,0,0)');
          gradient.addColorStop(1, 'rgba(0,0,0,1)');
          applyMask(gradient);
        }
        if (edges.top) {
          const gradient = context.createLinearGradient(0, 0, 0, feather);
          gradient.addColorStop(0, 'rgba(0,0,0,0)');
          gradient.addColorStop(1, 'rgba(0,0,0,1)');
          applyMask(gradient);
        }
        if (edges.bottom) {
          const gradient = context.createLinearGradient(0, size.y, 0, size.y - feather);
          gradient.addColorStop(0, 'rgba(0,0,0,0)');
          gradient.addColorStop(1, 'rgba(0,0,0,1)');
          applyMask(gradient);
        }
        done(null, canvas);
      };
      image.onerror = () => done(new Error('Не удалось загрузить локальный тайл острова'), canvas);
      image.src = this.getTileUrl(coords);
      return canvas;
    }
  });
  layers.localIslandTiles = new FeatheredTileLayer(config.localTilesUrl, {
    pane:'islandTilesPane',
    minZoom:12,
    maxZoom:22,
    minNativeZoom:13,
    maxNativeZoom:18,
    opacity:1,
    noWrap:true,
    keepBuffer:3,
    className:'local-island-tile'
  }).addTo(map);
  layers.basemap.once('load', hideMapLoader);
  window.setTimeout(hideMapLoader, 5000);

  function createWmsLayer(layerName) {
    return L.tileLayer.wms(config.qgisWmsUrl, {
      layers: layerName, format: 'image/png', transparent: true, version: '1.3.0',
      crs: L.CRS.EPSG3857, tiled: true, maxZoom: 22, attribution: 'QGIS Server', pane:'baseMapsPane'
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

  const providerPresets = {
    custom:{ type:'xyz', url:'', minZoom:12, maxZoom:22, attribution:'' },
    osm:{ type:'xyz', url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png', minZoom:0, maxZoom:22, attribution:'© OpenStreetMap' },
    'local-xyz':{ type:'xyz', url:'/local-tiles/{z}/{x}/{y}.png', minZoom:12, maxZoom:22, attribution:'Локальные тайлы' },
    'local-wms':{ type:'wms', url:config.qgisWmsUrl, minZoom:12, maxZoom:22, attribution:'QGIS Server', wmsLayers:'', wmsStyles:'', wmsFormat:'image/png', wmsVersion:'1.3.0', wmsTransparent:true },
    'google-roads':{ type:'xyz', url:'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', minZoom:0, maxZoom:22, attribution:'Google', subdomains:'0123' },
    'google-satellite':{ type:'xyz', url:'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', minZoom:0, maxZoom:22, attribution:'Google', subdomains:'0123' },
    'yandex-custom':{ type:'xyz', url:'', minZoom:0, maxZoom:22, attribution:'Yandex' }
  };

  function showCreateLayerModal(layerId = '') {
    if (!isAdmin) {
      ui.message.textContent = 'Создание и редактирование пользовательских слоёв доступно только администратору.';
      showAdminModal();
      return;
    }
    editingCustomLayerId = layerId;
    const layerConfig = layerId ? customLayers.find((item) => item.id === layerId) : null;
    document.querySelector('#create-layer-title').textContent = layerConfig ? 'Редактировать слой' : 'Создать слой';
    document.querySelector('.create-layer-header p').textContent = layerConfig ? 'Измените параметры слоя. После сохранения слой будет пересоздан на карте.' : 'Добавьте внешний или локальный слой по URL. Поддерживаются XYZ, TMS и WMS.';
    ui.createLayerSubmit.textContent = layerConfig ? 'Сохранить слой' : 'Добавить слой';
    if (layerConfig) fillCustomLayerForm(layerConfig);
    else {
      ui.createLayerForm.reset();
      applyProviderPreset('custom');
    }
    ui.createLayerStatus.textContent = '';
    ui.createLayerStatus.className = 'create-layer-status';
    updateCreateLayerSubmitState();
    ui.createLayerBackdrop.classList.add('is-visible');
    ui.createLayerBackdrop.setAttribute('aria-hidden', 'false');
    window.setTimeout(() => ui.customName.focus(), 80);
  }

  function hideCreateLayerModal() {
    ui.createLayerBackdrop.classList.remove('is-visible');
    ui.createLayerBackdrop.setAttribute('aria-hidden', 'true');
    editingCustomLayerId = '';
  }

  function updateWmsFieldsVisibility() {
    const isWms = ui.customType.value === 'wms';
    ui.customWmsFields.hidden = !isWms;
    ui.customUrl.placeholder = isWms ? 'https://server/qgis_mapserv.fcgi.exe?...' : 'https://server/tiles/{z}/{x}/{y}.png';
    updateCreateLayerSubmitState();
  }

  function applyProviderPreset(providerKey) {
    const preset = providerPresets[providerKey] || providerPresets.custom;
    ui.customType.value = preset.type;
    ui.customUrl.value = preset.url || '';
    ui.customMinZoom.value = preset.minZoom;
    ui.customMaxZoom.value = preset.maxZoom;
    ui.customAttribution.value = preset.attribution || '';
    ui.customWmsLayers.value = preset.wmsLayers || '';
    ui.customWmsStyles.value = preset.wmsStyles || '';
    ui.customWmsFormat.value = preset.wmsFormat || 'image/png';
    ui.customWmsVersion.value = preset.wmsVersion || '1.3.0';
    ui.customTransparent.checked = preset.wmsTransparent !== false;
    updateWmsFieldsVisibility();
  }

  function fillCustomLayerForm(layerConfig) {
    ui.customName.value = layerConfig.name || '';
    ui.customGroup.value = layerConfig.group || 'maps';
    ui.customProvider.value = layerConfig.provider || 'custom';
    ui.customType.value = layerConfig.type || 'xyz';
    ui.customUrl.value = layerConfig.url || '';
    ui.customMinZoom.value = Number.isFinite(Number(layerConfig.minZoom)) ? layerConfig.minZoom : 12;
    ui.customMaxZoom.value = Number.isFinite(Number(layerConfig.maxZoom)) ? layerConfig.maxZoom : 22;
    ui.customAttribution.value = layerConfig.attribution || '';
    ui.customWmsLayers.value = layerConfig.wmsLayers || '';
    ui.customWmsStyles.value = layerConfig.wmsStyles || '';
    ui.customWmsFormat.value = layerConfig.wmsFormat || 'image/png';
    ui.customWmsVersion.value = layerConfig.wmsVersion || '1.3.0';
    ui.customTransparent.checked = layerConfig.wmsTransparent !== false;
    updateWmsFieldsVisibility();
  }

  function updateCreateLayerSubmitState() {
    if (!ui.createLayerSubmit) return;
    ui.createLayerSubmit.disabled = validateCustomLayerConfig(readCustomLayerForm(), { allowSameId:editingCustomLayerId }).length > 0;
  }

  function readCustomLayerForm() {
    const preset = providerPresets[ui.customProvider.value] || {};
    return {
      id: editingCustomLayerId || `custom-layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: ui.customName.value.trim(),
      group: ui.customGroup.value,
      provider: ui.customProvider.value,
      type: ui.customType.value,
      url: ui.customUrl.value.trim(),
      minZoom: Number(ui.customMinZoom.value),
      maxZoom: Number(ui.customMaxZoom.value),
      attribution: ui.customAttribution.value.trim(),
      subdomains: preset.subdomains || undefined,
      wmsLayers: ui.customWmsLayers.value.trim(),
      wmsStyles: ui.customWmsStyles.value.trim(),
      wmsFormat: ui.customWmsFormat.value.trim() || 'image/png',
      wmsVersion: ui.customWmsVersion.value.trim() || '1.3.0',
      wmsTransparent: ui.customTransparent.checked,
      enabled: false
    };
  }

  function validateCustomLayerConfig(layerConfig, { allowSameId = '' } = {}) {
    const errors = [];
    const name = String(layerConfig.name || '').trim();
    const url = String(layerConfig.url || '').trim();
    if (!name) errors.push('Укажите название слоя.');
    if (name.length > 60) errors.push('Название слоя должно быть не длиннее 60 символов.');
    if (customLayers.some((item) => item.id !== allowSameId && item.name.toLowerCase() === name.toLowerCase())) errors.push('Слой с таким названием уже есть.');
    if (!['maps','zones'].includes(layerConfig.group || 'maps')) errors.push('Выберите группу слоя: Карты или Зоны.');
    if (!['xyz','tms','wms'].includes(layerConfig.type)) errors.push('Выберите тип слоя: XYZ, TMS или WMS.');
    if (!url || !/^(https?:\/\/|\/)/i.test(url)) errors.push('URL должен начинаться с http://, https:// или /.');
    if (['xyz','tms'].includes(layerConfig.type) && !(/\{x\}/i.test(url) && /\{y\}/i.test(url) && /\{z\}/i.test(url))) errors.push('Для XYZ/TMS URL должен содержать {x}, {y} и {z}.');
    if (layerConfig.type === 'wms' && !String(layerConfig.wmsLayers || '').trim()) errors.push('Для WMS укажите поле layers.');
    if (!Number.isFinite(layerConfig.minZoom) || !Number.isFinite(layerConfig.maxZoom)) errors.push('Масштабы должны быть числами.');
    if (layerConfig.minZoom < 0 || layerConfig.maxZoom > 22 || layerConfig.minZoom > layerConfig.maxZoom) errors.push('Масштаб должен быть от 0 до 22, а минимум не больше максимума.');
    return errors;
  }

  function warnCustomLayerTileError(item, event) {
    console.warn(`Не удалось загрузить тайл пользовательского слоя "${item.name}"`, event);
    if (item.tileErrorNotified) return;
    item.tileErrorNotified = true;
    ui.message.textContent = `Не удалось загрузить часть тайлов слоя «${item.name}». Проверьте URL или доступность сервера.`;
    window.setTimeout(() => {
      if (ui.message.textContent.includes(item.name)) ui.message.textContent = '';
    }, 5000);
  }

  function createCustomLeafletLayer(layerConfig) {
    const commonOptions = {
      pane:layerConfig.pane || getLayerPane(layerConfig),
      minZoom: layerConfig.minZoom,
      maxZoom: layerConfig.maxZoom,
      attribution: layerConfig.attribution || undefined,
      subdomains: layerConfig.subdomains || 'abc'
    };
    if (layerConfig.type === 'wms') {
      return L.tileLayer.wms(layerConfig.url, {
        ...commonOptions,
        layers: layerConfig.wmsLayers,
        styles: layerConfig.wmsStyles || '',
        format: layerConfig.wmsFormat || 'image/png',
        transparent: layerConfig.wmsTransparent !== false,
        version: layerConfig.wmsVersion || '1.3.0',
        tiled: true
      });
    }
    return L.tileLayer(layerConfig.url, {
      ...commonOptions,
      tms: layerConfig.type === 'tms',
      maxNativeZoom: layerConfig.maxZoom,
      keepBuffer: 2
    });
  }

  function getLayerPane(layerConfig) {
    if (layerConfig.id === 'localIslandTiles' || layerConfig.name === 'Тайлы острова') return 'islandTilesPane';
    return (layerConfig.group || 'maps') === 'zones' ? 'zonesPane' : 'baseMapsPane';
  }

  function persistCustomLayers() {
    const data = customLayers.map(({ leafletLayer, tileErrorNotified, ...stored }) => stored);
    localStorage.setItem(CUSTOM_LAYERS_KEY, JSON.stringify(data));
  }

  function renderCustomLayers() {
    document.querySelectorAll('.custom-layer-option').forEach((node) => node.remove());
    customLayers.forEach((item) => {
      const targetList = (item.group || 'maps') === 'zones' ? ui.zonesLayerList : ui.mapsLayerList;
      const row = document.createElement('label');
      row.className = `layer-option custom-layer-option ${item.enabled ? 'active' : ''}`;
      row.dataset.customLayerId = item.id;
      row.innerHTML = `<span class="layer-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.type.toUpperCase())} · ${escapeHtml(item.url)}</small></span><input data-custom-layer-toggle="${escapeHtml(item.id)}" data-exclusive-group="${escapeHtml(item.group || 'maps')}" type="checkbox" ${item.enabled ? 'checked' : ''}><span class="switch" aria-hidden="true"></span>`;
      targetList.appendChild(row);
    });
    renderLayerEditorList();
  }

  function addCustomLayer(layerConfig, { persist = true } = {}) {
    const normalized = {
      ...layerConfig,
      id: layerConfig.id || `custom-layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(layerConfig.name || '').trim(),
      group: ['maps','zones'].includes(layerConfig.group) ? layerConfig.group : 'maps',
      type: String(layerConfig.type || 'xyz').toLowerCase(),
      url: String(layerConfig.url || '').trim(),
      minZoom: Number(layerConfig.minZoom),
      maxZoom: Number(layerConfig.maxZoom),
      editable: layerConfig.editable !== false,
      deletable: layerConfig.deletable !== false,
      pane: layerConfig.pane || getLayerPane(layerConfig),
      enabled: layerConfig.enabled !== false
    };
    const errors = validateCustomLayerConfig(normalized, { allowSameId: normalized.id });
    if (errors.length) throw new Error(errors[0]);
    const item = { ...normalized };
    item.leafletLayer = createCustomLeafletLayer(item);
    item.leafletLayer.on('tileerror', (event) => warnCustomLayerTileError(item, event));
    customLayers.push(item);
    if (item.enabled) item.leafletLayer.addTo(map);
    renderCustomLayers();
    if (persist) persistCustomLayers();
    return item;
  }

  function loadCustomLayers() {
    let stored = [];
    try {
      stored = JSON.parse(localStorage.getItem(CUSTOM_LAYERS_KEY) || '[]');
    } catch (error) {
      console.warn('Не удалось прочитать пользовательские слои из localStorage', error);
    }
    if (!Array.isArray(stored)) return;
    stored.forEach((layerConfig) => {
      try {
        addCustomLayer(layerConfig, { persist:false });
      } catch (error) {
        console.warn('Пользовательский слой пропущен:', error.message, layerConfig);
      }
    });
    renderCustomLayers();
  }

  function setCustomLayerVisibility(id, visible) {
    const item = customLayers.find((layerItem) => layerItem.id === id);
    if (!item) return;
    if (visible) deactivateExclusiveLayers(item.group || 'maps', id);
    item.enabled = visible;
    if (visible) item.leafletLayer.addTo(map);
    else map.removeLayer(item.leafletLayer);
    persistCustomLayers();
    renderCustomLayers();
  }

  function deleteCustomLayer(id) {
    if (!isAdmin) {
      ui.message.textContent = 'Удалять пользовательские слои может только администратор.';
      showAdminModal();
      return;
    }
    const index = customLayers.findIndex((item) => item.id === id);
    if (index === -1) return;
    const [item] = customLayers.splice(index, 1);
    if (map.hasLayer(item.leafletLayer)) map.removeLayer(item.leafletLayer);
    persistCustomLayers();
    renderCustomLayers();
  }

  function renderLayerEditorList() {
    if (!ui.layerEditorList) return;
    if (!customLayers.length) {
      ui.layerEditorList.innerHTML = '<p class="editor-empty">Созданных администратором слоёв пока нет.</p>';
      return;
    }
    const groups = [
      ['maps', 'Карты'],
      ['zones', 'Зоны']
    ];
    ui.layerEditorList.innerHTML = groups.map(([group, title]) => {
      const groupLayers = customLayers.filter((item) => (item.group || 'maps') === group);
      if (!groupLayers.length) return '';
      return `<section class="layer-editor-group"><h3>${title}</h3>${groupLayers.map((item) => `
        <article class="layer-editor-item">
          <button class="layer-editor-select" type="button" data-custom-layer-edit="${escapeHtml(item.id)}">
            <strong>${escapeHtml(item.name)}</strong>
            <small>${escapeHtml(item.type.toUpperCase())} · ${escapeHtml(item.url)}</small>
          </button>
          <button class="layer-editor-delete" type="button" data-custom-layer-delete="${escapeHtml(item.id)}" aria-label="Удалить слой ${escapeHtml(item.name)}">Удалить</button>
        </article>
      `).join('')}</section>`;
    }).join('') || '<p class="editor-empty">Созданных администратором слоёв пока нет.</p>';
  }

  function showEditorMode() {
    ui.editorTitle.textContent = 'Редактор';
    ui.editorDescription.textContent = 'Выберите режим редактирования.';
    ui.editorModeView.hidden = false;
    ui.zoneEditorView.hidden = true;
    ui.layerEditorView.hidden = true;
  }

  function showZoneEditorPlaceholder() {
    ui.editorTitle.textContent = 'Редактор зон';
    ui.editorDescription.textContent = 'Раздел подготовлен для будущих функций редактирования зон.';
    ui.editorModeView.hidden = true;
    ui.zoneEditorView.hidden = false;
    ui.layerEditorView.hidden = true;
  }

  function showLayerEditor() {
    ui.editorTitle.textContent = 'Редактор слоёв';
    ui.editorDescription.textContent = 'Выберите слой, чтобы изменить его параметры. Удаление доступно только в этом разделе.';
    renderLayerEditorList();
    ui.editorModeView.hidden = true;
    ui.zoneEditorView.hidden = true;
    ui.layerEditorView.hidden = false;
  }

  function showEditorModal() {
    if (!isAdmin) {
      ui.message.textContent = 'Редактор доступен только администратору.';
      showAdminModal();
      return;
    }
    showEditorMode();
    ui.editorBackdrop.classList.add('is-visible');
    ui.editorBackdrop.setAttribute('aria-hidden', 'false');
    window.setTimeout(() => ui.editorClose.focus(), 80);
  }

  function hideEditorModal() {
    ui.editorBackdrop.classList.remove('is-visible');
    ui.editorBackdrop.setAttribute('aria-hidden', 'true');
  }

  function deactivateExclusiveLayers(group, exceptCustomId = '') {
    toggleRegistry.forEach((item) => {
      if (item.input.dataset.exclusiveGroup === group) {
        item.input.checked = false;
        item.option.classList.remove('active');
        const otherLayer = layers[item.key];
        if (otherLayer && map.hasLayer(otherLayer)) map.removeLayer(otherLayer);
      }
    });
    customLayers.forEach((item) => {
      if (item.id !== exceptCustomId && (item.group || 'maps') === group) {
        item.enabled = false;
        if (map.hasLayer(item.leafletLayer)) map.removeLayer(item.leafletLayer);
      }
    });
  }

  function updateCustomLayer(id, layerConfig) {
    if (!isAdmin) {
      ui.message.textContent = 'Редактировать пользовательские слои может только администратор.';
      showAdminModal();
      return;
    }
    const index = customLayers.findIndex((item) => item.id === id);
    if (index === -1) throw new Error('Слой для редактирования не найден.');
    const previous = customLayers[index];
    const normalized = {
      ...layerConfig,
      id,
      enabled: previous.enabled,
      name: String(layerConfig.name || '').trim(),
      group: ['maps','zones'].includes(layerConfig.group) ? layerConfig.group : 'maps',
      type: String(layerConfig.type || 'xyz').toLowerCase(),
      url: String(layerConfig.url || '').trim(),
      minZoom: Number(layerConfig.minZoom),
      maxZoom: Number(layerConfig.maxZoom),
      editable: previous.editable !== false,
      deletable: previous.deletable !== false,
      pane: getLayerPane(layerConfig)
    };
    const errors = validateCustomLayerConfig(normalized, { allowSameId:id });
    if (errors.length) throw new Error(errors[0]);
    if (map.hasLayer(previous.leafletLayer)) map.removeLayer(previous.leafletLayer);
    const next = { ...normalized };
    next.leafletLayer = createCustomLeafletLayer(next);
    next.leafletLayer.on('tileerror', (event) => warnCustomLayerTileError(next, event));
    customLayers[index] = next;
    if (next.enabled) {
      deactivateExclusiveLayers(next.group || 'maps', next.id);
      next.leafletLayer.addTo(map);
    }
    persistCustomLayers();
    renderCustomLayers();
    return next;
  }

  loadCustomLayers();

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
      pane:'zonesPane',
      renderer:zonesRenderer,
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
    layers.polygon90273.on('add', () => layers.polygon90273.bringToFront());
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
          if (group) {
            toggleRegistry.forEach((item) => {
              if (item.input !== event.target && item.input.dataset.exclusiveGroup === group) {
                item.input.checked = false;
                item.option.classList.remove('active');
                const otherLayer = layers[item.key];
                if (otherLayer && map.hasLayer(otherLayer)) map.removeLayer(otherLayer);
              }
            });
            customLayers.forEach((item) => {
              if ((item.group || 'maps') === group) {
                item.enabled = false;
                if (map.hasLayer(item.leafletLayer)) map.removeLayer(item.leafletLayer);
              }
            });
            persistCustomLayers();
            renderCustomLayers();
          }
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
  bindToggle('#toggle-local-island-tiles', 'localIslandTiles');
  bindToggle('#toggle-polygon-90273', 'polygon90273', loadPolygon90273);
  ui.createLayerButton.addEventListener('click', () => showCreateLayerModal());
  ui.createLayerClose.addEventListener('click', hideCreateLayerModal);
  ui.createLayerCancel.addEventListener('click', hideCreateLayerModal);
  ui.createLayerBackdrop.addEventListener('click', (event) => {
    if (event.target === ui.createLayerBackdrop) hideCreateLayerModal();
  });
  ui.customProvider.addEventListener('change', () => applyProviderPreset(ui.customProvider.value));
  ui.customType.addEventListener('change', updateWmsFieldsVisibility);
  ui.createLayerForm.addEventListener('input', () => {
    ui.createLayerStatus.textContent = '';
    ui.createLayerStatus.className = 'create-layer-status';
    updateCreateLayerSubmitState();
  });
  ui.createLayerForm.addEventListener('change', updateCreateLayerSubmitState);
  ui.createLayerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!isAdmin) {
      ui.createLayerStatus.textContent = 'Создавать и редактировать слои может только администратор.';
      ui.createLayerStatus.className = 'create-layer-status error';
      showAdminModal();
      return;
    }
    const layerConfig = readCustomLayerForm();
    const errors = validateCustomLayerConfig(layerConfig, { allowSameId:editingCustomLayerId });
    if (errors.length) {
      ui.createLayerStatus.textContent = errors[0];
      ui.createLayerStatus.className = 'create-layer-status error';
      return;
    }
    try {
      if (editingCustomLayerId) updateCustomLayer(editingCustomLayerId, layerConfig);
      else addCustomLayer(layerConfig);
      const actionText = editingCustomLayerId ? 'сохранён' : 'добавлен';
      ui.createLayerForm.reset();
      applyProviderPreset('custom');
      ui.createLayerStatus.textContent = '';
      hideCreateLayerModal();
      ui.message.textContent = `Слой «${layerConfig.name}» ${actionText}.`;
      window.setTimeout(() => {
        if (ui.message.textContent.includes(layerConfig.name)) ui.message.textContent = '';
      }, 3500);
    } catch (error) {
      ui.createLayerStatus.textContent = error.message;
      ui.createLayerStatus.className = 'create-layer-status error';
    }
  });
  document.addEventListener('change', (event) => {
    const id = event.target.dataset.customLayerToggle;
    if (id) setCustomLayerVisibility(id, event.target.checked);
  });
  ui.layerEditorList.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-custom-layer-edit]');
    if (editButton) {
      hideEditorModal();
      showCreateLayerModal(editButton.dataset.customLayerEdit);
      return;
    }
    const button = event.target.closest('[data-custom-layer-delete]');
    if (button) deleteCustomLayer(button.dataset.customLayerDelete);
  });
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
  ui.adminEditor.addEventListener('click', openAdminEditor);
  ui.adminLogout.addEventListener('click', logoutAdmin);
  ui.editorClose.addEventListener('click', hideEditorModal);
  ui.editorBackdrop.addEventListener('click', (event) => {
    if (event.target === ui.editorBackdrop) hideEditorModal();
  });
  ui.openZoneEditor.addEventListener('click', showZoneEditorPlaceholder);
  ui.openLayerEditor.addEventListener('click', showLayerEditor);
  ui.backFromZoneEditor.addEventListener('click', showEditorMode);
  ui.backFromLayerEditor.addEventListener('click', showEditorMode);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.admin-menu-wrap')) {
      closeAdminDropdown();
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
    if (event.key === 'Escape' && ui.createLayerBackdrop.classList.contains('is-visible')) hideCreateLayerModal();
    if (event.key === 'Escape' && ui.editorBackdrop.classList.contains('is-visible')) hideEditorModal();
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
