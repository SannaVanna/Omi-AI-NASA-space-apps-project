/* ==========================================================================
   Omi AI — Study region map (Leaflet + NASA GIBS)

   * Basemaps: satellite with place names (Esri) by default, NASA Blue Marble
     and City Lights (GIBS), topographic, streets (OpenStreetMap), light and
     dark. No API keys are needed.
   * Real state boundaries for Nigeria (Natural Earth admin-1). Lagos and Edo
     are highlighted and selectable; other states show their name on hover.
   * NASA data overlay: monthly MERRA-2 2 m air temperature or bias-corrected
     precipitation from NASA GIBS — the same MERRA-2 product the trend
     analysis uses — with a legend in °C or mm/day.
   * The exact NASA POWER data point and its 0.5° x 0.625° grid cell.
   Selecting on the map updates the investigation form and vice versa.
   ========================================================================== */

(function () {
  'use strict';

  var COLORS = { lagos: '#14B8A6', edo: '#F97316' };
  var NIGERIA_BOUNDS = [[4.1, 2.6], [13.9, 14.7]];
  var STUDY_BOUNDS = [[5.7, 2.6], [7.7, 6.8]];
  var WORLD_VIEW = { center: [12, 12], zoom: 2 };
  var CELL_HALF_LAT = 0.25;
  var CELL_HALF_LON = 0.3125;
  var GEOJSON_URL = '/static/data/nigeria_states.geojson';

  var GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/';
  var NASA_ATTR = 'Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a>';

  // NASA GIBS MERRA-2 monthly layers. Month ranges come from the GIBS
  // capabilities document (checked Nov 2026); outside them tiles are empty.
  var DATA_LAYERS = {
    temperature: {
      id: 'MERRA2_2m_Air_Temperature_Monthly',
      title: 'Air temperature at 2 m',
      unit: '°C',
      defaultMonth: '2024-03',
      min: '1981-01',
      max: '2025-04',
      ranges: [['1980-01', '2023-11'], ['2024-02', '2024-04'], ['2024-06', '2025-04'], ['2025-07', '2026-08']],
      gradient: ['#5E4FA2', '#66C2A5', '#ABDDA4', '#E7F599', '#FEFDBC', '#FDDB87', '#FBA55C', '#EF6644', '#9E0142'],
      labels: ['< −53', '−19', '3', '25', '≥ 37']
    },
    rainfall: {
      id: 'MERRA2_Precipitation_Bias_Corrected_Monthly',
      title: 'Precipitation (bias-corrected)',
      unit: 'mm/day',
      defaultMonth: '2024-07',
      min: '2001-01',
      max: '2025-04',
      ranges: [['2000-06', '2025-04'], ['2025-07', '2026-08']],
      gradient: ['#F7FCFD', '#D3EEEB', '#B3E2D7', '#8DD2C0', '#64C1A2', '#49B280', '#319C5C', '#19823D', '#00441B'],
      labels: ['0', '4.5', '9', '13.6', '≥ 18']
    }
  };

  var map = null;
  var regions = {};
  var studyLayers = {};
  var statesLayer = null;
  var cellsLayer = null;
  var pointsLayer = null;
  var dataLayer = null;
  var dataState = { variable: 'none', month: null, opacity: 0.65 };
  var selected = [];
  var listeners = [];
  var infoControl = null;

  function esc(v) {
    return window.OmiUI ? window.OmiUI.escapeHtml(v) : String(v);
  }

  // ---------------------------------------------------------------- basemaps
  // All sources are keyless. (CARTO basemaps now require an API key.)
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var ESRI_ATTR = 'Tiles &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> &mdash; Esri, Maxar, Earthstar Geographics, and the GIS User Community';
  var OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

  function placeLabels() {
    return L.tileLayer(ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { minZoom: 2, maxZoom: 12, pane: 'labels', attribution: ESRI_ATTR });
  }

  function baseLayers() {
    var common = { minZoom: 2, maxZoom: 12 };
    return {
      'Satellite': L.layerGroup([
        L.tileLayer(ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', Object.assign({ attribution: ESRI_ATTR }, common)),
        placeLabels()
      ]),
      'NASA Blue Marble': L.layerGroup([
        L.tileLayer(GIBS + 'BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
          Object.assign({ maxNativeZoom: 8, attribution: NASA_ATTR }, common)),
        placeLabels()
      ]),
      'Topographic': L.tileLayer(ESRI + 'World_Topo_Map/MapServer/tile/{z}/{y}/{x}', Object.assign({ attribution: ESRI_ATTR }, common)),
      'Streets': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', Object.assign({ attribution: OSM_ATTR }, common)),
      'Light': L.tileLayer(ESRI + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', Object.assign({ attribution: ESRI_ATTR, maxNativeZoom: 16 }, common)),
      'Dark': L.tileLayer(ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', Object.assign({ attribution: ESRI_ATTR, maxNativeZoom: 16 }, common)),
      'NASA City Lights': L.layerGroup([
        L.tileLayer(GIBS + 'VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
          Object.assign({ maxNativeZoom: 8, attribution: NASA_ATTR }, common)),
        placeLabels()
      ])
    };
  }

  // ------------------------------------------------------------ data overlay
  function monthAvailable(cfg, month) {
    return cfg.ranges.some(function (r) { return month >= r[0] && month <= r[1]; });
  }

  function setDataLayer(variable, month) {
    dataState.variable = variable;
    if (dataLayer) {
      map.removeLayer(dataLayer);
      dataLayer = null;
    }
    var cfg = DATA_LAYERS[variable];
    if (!cfg) {
      renderDataPanel();
      refreshStyles();
      return;
    }
    dataState.month = month || dataState.month || cfg.defaultMonth;
    if (dataState.month < cfg.min || dataState.month > cfg.max) dataState.month = cfg.defaultMonth;
    dataLayer = L.tileLayer(
      GIBS + cfg.id + '/default/' + dataState.month + '-01/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png',
      { maxNativeZoom: 6, maxZoom: 12, opacity: dataState.opacity, pane: 'nasaData', attribution: NASA_ATTR + ' · MERRA-2' }
    ).addTo(map);
    renderDataPanel();
    refreshStyles();
  }

  function legendHtml(cfg) {
    return '<div class="map-legend">' +
      '<div class="map-legend-title">' + esc(cfg.title) + ' · ' + esc(dataState.month) + '</div>' +
      '<div class="map-legend-bar" style="background:linear-gradient(90deg,' + cfg.gradient.join(',') + ')"></div>' +
      '<div class="map-legend-labels">' + cfg.labels.map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') + '</div>' +
      '<div class="map-legend-unit">' + esc(cfg.unit) + ' · monthly mean, NASA MERRA-2</div>' +
    '</div>';
  }

  function renderDataPanel() {
    var panel = document.getElementById('map-data-panel');
    if (!panel) return;
    var cfg = DATA_LAYERS[dataState.variable];
    var html =
      '<div class="map-panel-title">NASA data layer</div>' +
      '<div class="map-seg" role="group" aria-label="NASA data layer">' +
        ['none', 'temperature', 'rainfall'].map(function (v) {
          var label = { none: 'Off', temperature: 'Temperature', rainfall: 'Rainfall' }[v];
          var on = dataState.variable === v;
          return '<button type="button" data-layer="' + v + '" class="' + (on ? 'is-active' : '') + '" aria-pressed="' + on + '">' + label + '</button>';
        }).join('') +
      '</div>';
    if (cfg) {
      html +=
        '<label class="map-field"><span>Month</span><input type="month" id="map-month" value="' + esc(dataState.month) + '" min="' + cfg.min + '" max="' + cfg.max + '"></label>' +
        '<label class="map-field"><span>Opacity</span><input type="range" id="map-opacity" min="0.2" max="1" step="0.05" value="' + dataState.opacity + '"></label>' +
        (monthAvailable(cfg, dataState.month) ? '' : '<div class="map-warn">NASA GIBS has no image for this month. Pick another month.</div>') +
        legendHtml(cfg);
    } else {
      html += '<p class="map-panel-hint">Show real NASA MERRA-2 monthly temperature or rainfall across the region.</p>';
    }
    panel.innerHTML = html;
  }

  function makeDataControl() {
    var Ctl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        var div = L.DomUtil.create('div', 'leaflet-bar map-card map-data-card');
        div.id = 'map-data-panel';
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        div.addEventListener('click', function (event) {
          var btn = event.target.closest('[data-layer]');
          if (btn) setDataLayer(btn.getAttribute('data-layer'));
        });
        div.addEventListener('change', function (event) {
          if (event.target.id === 'map-month' && event.target.value) setDataLayer(dataState.variable, event.target.value);
        });
        div.addEventListener('input', function (event) {
          if (event.target.id === 'map-opacity') {
            dataState.opacity = Number(event.target.value);
            if (dataLayer) dataLayer.setOpacity(dataState.opacity);
          }
        });
        return div;
      }
    });
    return new Ctl();
  }

  // -------------------------------------------------------------- info card
  function makeInfoControl() {
    var Ctl = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd: function () {
        var div = L.DomUtil.create('div', 'map-card map-info-card');
        L.DomEvent.disableClickPropagation(div);
        this._div = div;
        this.update();
        return div;
      },
      update: function (hoverName) {
        if (!this._div) return;
        if (hoverName) {
          this._div.innerHTML = '<div class="map-info-name">' + esc(hoverName) + '</div>';
          return;
        }
        if (!selected.length) {
          this._div.innerHTML = '<div class="map-info-name">Select a study region</div><div class="map-info-meta">Click Lagos or Edo</div>';
          return;
        }
        this._div.innerHTML = selected.map(function (id) {
          var r = regions[id];
          return '<div class="map-info-row"><span class="map-swatch" style="--sw:' + (COLORS[id] || '#14B8A6') + '"></span>' +
            '<div><div class="map-info-name">' + esc(r.name) + '</div>' +
            '<div class="map-info-meta">NASA data point ' + r.latitude.toFixed(2) + '° N, ' + r.longitude.toFixed(2) + '° E</div></div></div>';
        }).join('');
      }
    });
    return new Ctl();
  }

  // ------------------------------------------------------------ study areas
  function studyStyle(id) {
    var isSel = selected.indexOf(id) !== -1;
    var c = COLORS[id] || '#14B8A6';
    var dataOn = dataState.variable !== 'none';
    var fill = dataOn ? (isSel ? 0.12 : 0.04) : (isSel ? 0.45 : 0.25);
    return { color: isSel ? '#FFFFFF' : c, weight: isSel ? 3 : 2, fillColor: c, fillOpacity: fill, opacity: 1 };
  }

  function otherStateStyle() {
    return { color: '#FFFFFF', weight: 0.8, opacity: 0.55, fillColor: '#FFFFFF', fillOpacity: 0.02, dashArray: '2 3' };
  }

  function popupHtml(region) {
    return '<div class="omi-popup">' +
      '<strong>' + esc(region.name) + '</strong>' +
      '<div class="omi-popup-meta">' + esc(region.description || '') + '</div>' +
      '<div class="omi-popup-meta">NASA data point: ' + region.latitude.toFixed(4) + '° N, ' + region.longitude.toFixed(4) + '° E</div>' +
      '<div class="omi-popup-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-map-analyse="' + esc(region.id) + '">Analyse ' + esc(region.name) + '</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-map-analyse="both">Compare both</button>' +
      '</div>' +
    '</div>';
  }

  function refreshStyles() {
    Object.keys(studyLayers).forEach(function (id) {
      studyLayers[id].forEach(function (layer) {
        layer.setStyle(studyStyle(id));
        if (selected.indexOf(id) !== -1 && layer.bringToFront) layer.bringToFront();
      });
    });
    if (pointsLayer) {
      pointsLayer.eachLayer(function (pt) {
        var isSel = selected.indexOf(pt.options.regionId) !== -1;
        pt.setStyle({ radius: isSel ? 7 : 5, weight: isSel ? 3 : 2 });
        if (pt.bringToFront) pt.bringToFront();
      });
    }
    if (infoControl) infoControl.update();
  }

  function notify(regionKey) {
    listeners.forEach(function (fn) { try { fn(regionKey); } catch (e) {} });
  }

  function select(regionKey, options) {
    var opts = options || {};
    selected = regionKey === 'both' ? Object.keys(regions) : (regions[regionKey] ? [regionKey] : []);
    refreshStyles();
    if (map && opts.fly && selected.length) {
      if (selected.length > 1) {
        map.flyToBounds(STUDY_BOUNDS, { duration: 0.8 });
      } else if (studyLayers[selected[0]] && studyLayers[selected[0]][0]) {
        map.flyToBounds(studyLayers[selected[0]][0].getBounds(), { duration: 0.8, padding: [40, 40], maxZoom: 9 });
      }
    }
  }

  function setViewButtons(view) {
    [['map-world-btn', 'world'], ['map-nigeria-btn', 'nigeria']].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el) return;
      el.classList.toggle('is-active', view === pair[1]);
      el.setAttribute('aria-pressed', view === pair[1] ? 'true' : 'false');
    });
  }

  function showWorld() {
    if (map) map.flyTo(WORLD_VIEW.center, WORLD_VIEW.zoom, { duration: 0.8 });
    setViewButtons('world');
  }

  function showNigeria() {
    if (map) map.flyToBounds(NIGERIA_BOUNDS, { duration: 0.9 });
    setViewButtons('nigeria');
  }

  function choose(id, layerForPopup, latlng) {
    select(id, { fly: false });
    notify(id);
    if (layerForPopup) layerForPopup.openPopup(latlng);
  }

  function addStates(geojson) {
    statesLayer = L.geoJSON(geojson, {
      pane: 'states',
      style: function (feature) {
        var id = feature.properties.region_id;
        return id ? studyStyle(id) : otherStateStyle();
      },
      onEachFeature: function (feature, layer) {
        var id = feature.properties.region_id;
        var name = feature.properties.name + (feature.properties.name === 'Federal Capital Territory' ? '' : ' State');
        if (id && regions[id]) {
          (studyLayers[id] = studyLayers[id] || []).push(layer);
          layer.bindTooltip(regions[id].name, { sticky: true, direction: 'top', className: 'state-label state-label-' + id });
          layer.bindPopup(popupHtml(regions[id]), { autoPanPadding: [24, 24] });
          layer.on('click', function (e) { choose(id, null, e.latlng); });
          layer.on('mouseover', function () { layer.setStyle({ fillOpacity: 0.55 }); });
          layer.on('mouseout', function () { layer.setStyle(studyStyle(id)); });
        } else {
          layer.on('mouseover', function () { layer.setStyle({ fillOpacity: 0.12, weight: 1.4 }); if (infoControl) infoControl.update(name); });
          layer.on('mouseout', function () { layer.setStyle(otherStateStyle()); if (infoControl) infoControl.update(); });
          layer.bindPopup('<div class="omi-popup"><strong>' + esc(name) + '</strong><div class="omi-popup-meta">Not a study region yet. Omi currently analyses Lagos State and Edo State.</div></div>');
        }
      }
    }).addTo(map);
  }

  function addPointsAndCells() {
    cellsLayer = L.layerGroup();
    pointsLayer = L.layerGroup();
    Object.keys(regions).forEach(function (id) {
      var r = regions[id];
      var c = COLORS[id] || '#14B8A6';
      L.rectangle(
        [[r.latitude - CELL_HALF_LAT, r.longitude - CELL_HALF_LON], [r.latitude + CELL_HALF_LAT, r.longitude + CELL_HALF_LON]],
        { pane: 'cells', color: '#FFFFFF', weight: 1.5, dashArray: '5 4', fill: false, interactive: true }
      ).bindTooltip('NASA MERRA-2 grid cell used for ' + r.name + ' (0.5° × 0.625°, ~55 × 69 km)', { sticky: true })
        .addTo(cellsLayer);
      var pt = L.circleMarker([r.latitude, r.longitude], {
        pane: 'points', regionId: id, radius: 5, color: '#FFFFFF', weight: 2, fillColor: c, fillOpacity: 1
      }).bindTooltip(r.name + ' · NASA POWER data point', { direction: 'top', offset: [0, -6] });
      pt.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        choose(id);
        pt.bindPopup(popupHtml(r)).openPopup();
      });
      pt.addTo(pointsLayer);
    });
    // Grid cells are optional (layers menu) to keep the default view clean.
    pointsLayer.addTo(map);
  }

  function init() {
    var el = document.getElementById('region-map');
    var root = document.getElementById('dashboard-root');
    if (!el || !root) return;
    if (typeof L === 'undefined') {
      el.innerHTML = '<div class="empty-state"><p>The map could not load. You can still choose a region with the Location menu above.</p></div>';
      return;
    }

    map = L.map(el, {
      center: WORLD_VIEW.center,
      zoom: WORLD_VIEW.zoom,
      minZoom: 2,
      maxZoom: 11,
      worldCopyJump: true,
      scrollWheelZoom: false,
      zoomControl: false,
      attributionControl: true
    });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

    // Draw order: basemap < NASA data < states < cells < points < labels.
    map.createPane('nasaData').style.zIndex = 350;
    map.createPane('states').style.zIndex = 410;
    map.createPane('cells').style.zIndex = 420;
    map.createPane('points').style.zIndex = 430;
    var labels = map.createPane('labels');
    labels.style.zIndex = 440;
    labels.style.pointerEvents = 'none';

    var bases = baseLayers();
    bases['Satellite'].addTo(map);
    L.control.zoom({ position: 'topleft' }).addTo(map);
    L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 120 }).addTo(map);
    infoControl = makeInfoControl().addTo(map);
    makeDataControl().addTo(map);
    renderDataPanel();

    map.on('focus click', function () { map.scrollWheelZoom.enable(); });
    map.on('blur mouseout', function () { map.scrollWheelZoom.disable(); });

    el.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-map-analyse]');
      if (!btn) return;
      var key = btn.getAttribute('data-map-analyse');
      map.closePopup();
      select(key, { fly: true });
      document.dispatchEvent(new CustomEvent('omi:map-analyse', { detail: { region: key } }));
    });

    var worldBtn = document.getElementById('map-world-btn');
    var nigeriaBtn = document.getElementById('map-nigeria-btn');
    if (worldBtn) worldBtn.addEventListener('click', showWorld);
    if (nigeriaBtn) nigeriaBtn.addEventListener('click', showNigeria);

    // Follow the dashboard's Variable menu: offer the matching NASA layer.
    var variableSelect = document.getElementById('inv-variable');
    if (variableSelect) {
      variableSelect.addEventListener('change', function () {
        if (dataState.variable !== 'none') setDataLayer(variableSelect.value);
      });
    }

    var endpoint = root.getAttribute('data-regions-endpoint') || '/api/regions';
    Promise.all([
      fetch(endpoint, { headers: { 'Accept': 'application/json' } }).then(function (r) { return r.ok ? r.json() : []; }),
      fetch(GEOJSON_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (results) {
      (results[0] || []).forEach(function (region) {
        if (typeof region.latitude === 'number' && typeof region.longitude === 'number') regions[region.id] = region;
      });
      if (results[1]) addStates(results[1]);
      addPointsAndCells();

      var overlays = {};
      if (statesLayer) overlays['State boundaries'] = statesLayer;
      overlays['NASA data grid cells'] = cellsLayer;
      overlays['NASA data points'] = pointsLayer;
      L.control.layers(bases, overlays, { position: 'topleft', collapsed: true }).addTo(map);

      var initial = document.getElementById('inv-region');
      select(initial ? initial.value : 'lagos', { fly: false });
      setViewButtons('world');
      setTimeout(showNigeria, 800);
    }).catch(function () {});

    window.addEventListener('resize', function () { map.invalidateSize(); });
  }

  window.OmiMap = {
    select: select,
    onSelect: function (fn) { listeners.push(fn); },
    showWorld: showWorld,
    showNigeria: showNigeria,
    setDataLayer: setDataLayer,
    getMap: function () { return map; }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
