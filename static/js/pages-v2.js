/* ==========================================================================
   Omi AI v2 pages: Map & Radar, Alerts, Route Weather, Saved Places.
   ========================================================================== */
(function () {
  'use strict';
  var V = window.OmiV2, esc = V.esc;
  var IMG = '/static/img/weather/';
  var GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/';
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var placesCache = null;

  function places() {
    if (placesCache) return Promise.resolve(placesCache);
    return V.getJSON('/api/places').then(function (list) { placesCache = list; return list; });
  }
  function weather(id) { return V.getJSON('/api/weather?place=' + encodeURIComponent(id)); }
  function baseMap(el, opts) {
    var map = L.map(el, Object.assign({ zoomControl: true, attributionControl: true, minZoom: 4, maxZoom: 12 }, opts || {}));
    var gray = L.tileLayer(ESRI + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri', maxZoom: 16 }).addTo(map);
    return { map: map, gray: gray };
  }
  function labels(map) {
    return L.tileLayer(ESRI + 'Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'labels' }).addTo(map);
  }
  function imergFrame(stepsBack) {
    var d = new Date(Date.now() - 6 * 3600 * 1000 - stepsBack * 30 * 60 * 1000);
    d.setUTCMinutes(d.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
    return d.toISOString().slice(0, 19) + 'Z';
  }
  function wat(iso) {
    return new Date(iso).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) + ' WAT';
  }

  // ================================================================ MAP
  function initMap() {
    var el = document.getElementById('radar-map');
    if (!el || !window.L) return;
    var b = baseMap(el); var map = b.map;
    map.setView([8.6, 7.6], 6);
    map.createPane('labels'); map.getPane('labels').style.zIndex = 450; map.getPane('labels').style.pointerEvents = 'none';
    labels(map);

    var sat = L.tileLayer(ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Imagery © Esri', maxZoom: 16 });
    var month = (function () { var d = new Date(); d.setUTCMonth(d.getUTCMonth() - 4); return d.toISOString().slice(0, 7); })();
    var temp = L.tileLayer(GIBS + 'MERRA2_2m_Air_Temperature_Monthly/default/' + month + '-01/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png', { opacity: 0.6, maxNativeZoom: 6, attribution: 'NASA GIBS · MERRA-2' });
    var frames = [], current = 6;
    for (var i = 6; i >= 0; i--) frames.push(imergFrame(i));
    var radar = L.tileLayer(GIBS + 'IMERG_Precipitation_Rate/default/' + frames[6] + '/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png', { opacity: 0.85, maxNativeZoom: 6, attribution: 'NASA GIBS · GPM IMERG', zIndex: 5 }).addTo(map);
    var states = null;
    fetch('/static/data/nigeria_states.geojson').then(function (r) { return r.json(); }).then(function (gj) {
      states = L.geoJSON(gj, {
        style: function (f) {
          var id = f.properties.region_id;
          return id ? { color: id === 'lagos' ? '#0EA5A0' : '#F08C00', weight: 2.5, fillOpacity: 0.12 } : { color: '#6B7FA3', weight: 0.8, fillOpacity: 0, dashArray: '3 3' };
        },
        onEachFeature: function (f, layer) { layer.bindTooltip(f.properties.name, { sticky: true }); }
      }).addTo(map);
    }).catch(function () {});

    var stamp = document.querySelector('[data-radar-stamp]');
    var slider = document.querySelector('[data-radar-slider]');
    function showFrame(n) {
      current = n;
      radar.setUrl(GIBS + 'IMERG_Precipitation_Rate/default/' + frames[n] + '/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png');
      if (stamp) stamp.textContent = wat(frames[n]);
      if (slider) slider.value = n;
    }
    showFrame(6);
    if (slider) slider.addEventListener('input', function () { showFrame(+slider.value); });
    var timer = null, play = document.querySelector('[data-radar-play]');
    if (play) play.addEventListener('click', function () {
      if (timer) { clearInterval(timer); timer = null; play.classList.remove('is-playing'); return; }
      play.classList.add('is-playing');
      var n = 0; showFrame(0);
      timer = setInterval(function () { n++; if (n > 6) { clearInterval(timer); timer = null; play.classList.remove('is-playing'); return; } showFrame(n); }, 900);
    });

    var layers = { radar: radar, temp: temp, sat: sat };
    document.querySelectorAll('[data-layer]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var k = cb.getAttribute('data-layer');
        var layer = k === 'states' ? states : layers[k];
        if (!layer) return;
        if (cb.checked) layer.addTo(map); else map.removeLayer(layer);
        if (k === 'sat') b.gray.setOpacity(cb.checked ? 0 : 1);
      });
    });

    // City pins with live temperatures
    var detail = document.querySelector('[data-radar-detail]');
    places().then(function (list) {
      list.forEach(function (p) {
        var icon = L.divIcon({ className: 'city-pin-wrap', html: '<span class="city-pin">' + esc(p.name) + '</span>', iconSize: null });
        var m = L.marker([p.latitude, p.longitude], { icon: icon, keyboard: true, title: p.name }).addTo(map);
        weather(p.id).then(function (w) {
          m.setIcon(L.divIcon({ className: 'city-pin-wrap', iconSize: null, html: '<span class="city-pin"><img src="' + IMG + esc(w.current.icon) + '.svg" alt="">' + esc(p.name) + ' <b>' + w.current.temperature + '°</b></span>' }));
          m.on('click', function () { openDetail(p, w); });
        }).catch(function () {});
      });
    });

    function openDetail(p, w) {
      if (!detail) return;
      var study = p.id === 'lagos' || p.id === 'edo';
      detail.hidden = false;
      detail.innerHTML = '<div class="v2-card-head"><div><h2>' + esc(p.name) + '</h2><span class="muted">' + esc(p.state) + ' State' + (study ? ' · NASA study region' : '') + '</span></div>' +
        '<button type="button" class="fomi-close" data-close aria-label="Close">✕</button></div>' +
        '<div class="detail-now"><img src="' + IMG + esc(w.current.icon) + '.svg" alt="" width="56"><div><strong>' + w.current.temperature + '°C · ' + esc(w.current.condition) + '</strong>' +
        '<span>' + esc(w.alert.text) + '</span></div></div>' +
        '<div class="detail-hours">' + w.hourly.slice(0, 5).map(function (h) { return '<span><em>' + esc(h.label) + '</em><img src="' + IMG + esc(h.icon) + '.svg" alt="">' + h.temperature + '°</span>'; }).join('') + '</div>' +
        (study ? '<div class="detail-trend" data-detail-trend><div class="skeleton" style="height:70px"></div></div>' : '<p class="map-note muted">Climate trends are available for Lagos and Edo.</p>') +
        '<div class="research-actions">' + (study ? '<a class="btn btn-secondary btn-sm" href="/compare">Compare</a><a class="btn btn-primary btn-sm" href="/dashboard">Analyse</a>' : '<a class="btn btn-primary btn-sm" href="/route">Plan a trip</a>') + '</div>';
      detail.querySelector('[data-close]').addEventListener('click', function () { detail.hidden = true; });
      if (study) {
        fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ region: p.id, variable: 'temperature', detail: 'simple' }) })
          .then(function (r) { return r.json(); }).then(function (r) {
            var box = detail.querySelector('[data-detail-trend]'); if (!box || !r.trend) return;
            box.innerHTML = '<span class="muted">Temperature trend ' + r.period.start_year + '–' + r.period.end_year + '</span><div data-c></div><strong class="trend-line-' + (r.trend.significant ? 'ok' : 'na') + '">' +
              (r.trend.sens_slope.slope_per_decade > 0 ? '+' : '') + r.trend.sens_slope.slope_per_decade.toFixed(2) + ' °C per decade · ' + (r.trend.significant ? 'significant' : 'not significant') + '</strong>';
            window.OmiCharts.line(box.querySelector('[data-c]'), { minimal: true, height: 70, series: [
              { points: r.annual_series.map(function (a) { return { x: a.year, y: a.value }; }), color: '#2563EB', width: 1.8 },
              { points: r.trend.trend_line.map(function (a) { return { x: +String(a.date).slice(0, 4), y: a.value }; }), color: '#0B1F44', width: 2, dash: true }] });
          }).catch(function () {});
      }
    }
  }

  // ============================================================== ALERTS
  function initAlerts() {
    var root = document.querySelector('[data-alerts-page]');
    if (!root) return;
    var list = root.querySelector('[data-alert-list]'), data = null, filter = 'all';
    function render() {
      if (!data) return;
      var items = data.alerts.filter(function (a) { return filter === 'all' || a.severity === filter; });
      list.innerHTML = items.length ? items.map(V.alertItem).join('') :
        '<div class="empty-alerts"><img src="/static/img/omi/omi-wave.webp" alt="" width="96"><p><strong>All clear!</strong> No ' + (filter === 'all' ? '' : filter + ' ') + 'alerts for your places right now.</p></div>';
      ['all', 'severe', 'warning', 'info'].forEach(function (s) {
        var n = s === 'all' ? data.alerts.length : data.counts[s];
        var el = root.querySelector('[data-count="' + s + '"]'); if (el) el.textContent = '(' + n + ')';
      });
    }
    root.querySelectorAll('[data-sev]').forEach(function (b) {
      b.addEventListener('click', function () {
        filter = b.getAttribute('data-sev');
        root.querySelectorAll('[data-sev]').forEach(function (x) { var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on); });
        render();
      });
    });
    V.loadAlerts(true).then(function (d) {
      data = d; render();
      var meta = root.querySelector('[data-alert-meta]');
      if (meta) meta.textContent = 'Checked ' + wat(d.generated) + (d.unavailable.length ? ' · forecast unavailable for ' + d.unavailable.join(', ') : '');
      var pl = root.querySelector('[data-alert-places]');
      if (pl) pl.innerHTML = d.places.map(function (p) {
        return '<div class="place-row"><img src="' + IMG + esc(p.current.icon) + '.svg" alt="" width="40"><span><strong>' + esc(p.name) + '</strong><small>' + esc(p.current.condition) + '</small></span><b>' + p.current.temperature + '°</b></div>';
      }).join('');
    }).catch(function (e) { list.innerHTML = '<p class="muted">Live alerts are unavailable right now (' + esc(e.message) + ').</p>'; });
  }

  // =============================================================== ROUTE
  function initRoute() {
    var root = document.querySelector('[data-route-page]');
    if (!root) return;
    var from = root.querySelector('[data-route-from]'), to = root.querySelector('[data-route-to]');
    var out = root.querySelector('[data-route-result]');
    var map = null, layer = null;
    if (window.L) { var b = baseMap(document.getElementById('route-map')); map = b.map; map.setView([7.5, 5.5], 6); map.createPane('labels'); map.getPane('labels').style.zIndex = 450; labels(map); }

    places().then(function (list) {
      var opts = list.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + esc(p.state) + ')</option>'; }).join('');
      from.innerHTML = opts; to.innerHTML = opts;
      from.value = 'lagos'; to.value = 'abuja';
    });
    root.querySelector('[data-route-swap]').addEventListener('click', function () { var t = from.value; from.value = to.value; to.value = t; });
    var RISK = { low: ['pill--success', 'Safe to travel'], medium: ['pill--warning', 'Some rain'], high: ['pill--danger', 'Risky'] };
    root.querySelector('[data-route-form]').addEventListener('submit', function (e) {
      e.preventDefault();
      if (from.value === to.value) { out.innerHTML = '<p class="auth-error">Pick two different places.</p>'; return; }
      out.innerHTML = '<div class="skeleton" style="height: 220px"></div>';
      V.getJSON('/api/route?from=' + encodeURIComponent(from.value) + '&to=' + encodeURIComponent(to.value)).then(function (r) {
        out.innerHTML = '<div class="route-summary"><div><strong>' + esc(r.from.name) + ' → ' + esc(r.to.name) + '</strong>' +
          '<span class="muted">≈ ' + r.estimated_road_km + ' km · about ' + r.estimated_hours + ' h by road</span></div>' +
          '<span class="pill ' + RISK[r.risk][0] + '">' + RISK[r.risk][1] + '</span></div>' +
          '<div class="omi-says"><img src="/static/img/omi/omi-front.webp" alt=""><span>' + esc(r.advice) + '</span></div>' +
          '<ol class="route-steps">' + r.segments.map(function (s) {
            if (!s.available) return '<li><span class="muted">' + esc(s.name) + ': forecast unavailable</span></li>';
            return '<li class="risk-' + s.risk + '"><img src="' + IMG + esc(s.icon) + '.svg" alt="" width="40"><span><strong>' + esc(s.name) + '</strong><small>' + s.temperature + '° · ' + esc(s.condition) + '</small></span><em>' + esc(s.rain || '') + '</em></li>';
          }).join('') + '</ol><p class="map-note muted">' + esc(r.estimate_note) + '</p>';
        if (map) {
          if (layer) map.removeLayer(layer);
          var pts = r.segments.map(function (s) { return [s.latitude, s.longitude]; });
          layer = L.layerGroup([
            L.polyline(pts, { color: '#fff', weight: 10, opacity: 0.9 }),
            L.polyline(pts, { color: '#2563EB', weight: 5 })
          ].concat(r.segments.map(function (s, i) {
            var c = !s.available ? '#94A3B8' : s.risk === 'high' ? '#E5484D' : s.risk === 'medium' ? '#F59E0B' : (i === 0 ? '#2563EB' : i === r.segments.length - 1 ? '#0EA5A0' : '#16A34A');
            return L.circleMarker([s.latitude, s.longitude], { radius: i === 0 || i === r.segments.length - 1 ? 9 : 6, color: '#fff', weight: 3, fillColor: c, fillOpacity: 1 })
              .bindTooltip(esc(s.name) + (s.available ? ': ' + s.temperature + '° ' + esc(s.condition) : ''));
          }))).addTo(map);
          map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
        }
      }).catch(function (err) { out.innerHTML = '<p class="auth-error">Route weather is unavailable right now (' + esc(err.message) + ').</p>'; });
    });
  }

  // ============================================================== PLACES
  function initPlaces() {
    var root = document.querySelector('[data-places-page]');
    if (!root) return;
    var listEl = root.querySelector('[data-places-list]'), addEl = root.querySelector('[data-places-add]'), search = root.querySelector('[data-place-search]');
    var all = [];
    function byId(id) { return all.filter(function (p) { return p.id === id; })[0]; }
    function render() {
      var mine = V.places.get();
      root.querySelector('[data-places-count]').textContent = mine.length + ' of 12';
      listEl.innerHTML = mine.map(function (id, i) {
        var p = byId(id); if (!p) return '';
        return '<li class="place-row" data-id="' + esc(id) + '"><img src="' + IMG + 'partly-day.svg" alt="" width="40" data-wicon><span><strong>' + esc(p.name) + (i === 0 ? ' <em class="pill pill--brand">Home</em>' : '') + '</strong><small data-cond>Loading…</small></span><b data-temp>--</b>' +
          '<span class="place-actions">' + (i ? '<button type="button" data-home aria-label="Make ' + esc(p.name) + ' home">🏠</button>' : '') + (mine.length > 1 ? '<button type="button" data-remove aria-label="Remove ' + esc(p.name) + '">✕</button>' : '') + '</span></li>';
      }).join('');
      mine.forEach(function (id) {
        weather(id).then(function (w) {
          var row = listEl.querySelector('[data-id="' + id + '"]'); if (!row) return;
          row.querySelector('[data-wicon]').src = IMG + w.current.icon + '.svg';
          row.querySelector('[data-cond]').textContent = w.current.condition + (w.alert.minutes !== null ? ' · ' + w.alert.text : '');
          row.querySelector('[data-temp]').textContent = w.current.temperature + '°';
        }).catch(function () { var row = listEl.querySelector('[data-id="' + id + '"] [data-cond]'); if (row) row.textContent = 'Forecast unavailable'; });
      });
      renderAdd();
    }
    function renderAdd() {
      var mine = V.places.get(), q = (search.value || '').toLowerCase();
      var opts = all.filter(function (p) { return mine.indexOf(p.id) === -1 && (p.name + ' ' + p.state).toLowerCase().indexOf(q) !== -1; });
      addEl.innerHTML = opts.length ? opts.map(function (p) { return '<li><button type="button" data-add="' + esc(p.id) + '"><span><strong>' + esc(p.name) + '</strong><small>' + esc(p.state) + ' State</small></span><span class="pill pill--brand">+ Add</span></button></li>'; }).join('') : '<li class="muted">No more places match.</li>';
    }
    listEl.addEventListener('click', function (e) {
      var row = e.target.closest('[data-id]'); if (!row) return;
      var id = row.getAttribute('data-id'), mine = V.places.get();
      if (e.target.closest('[data-remove]')) V.places.set(mine.filter(function (x) { return x !== id; }));
      else if (e.target.closest('[data-home]')) V.places.set([id].concat(mine.filter(function (x) { return x !== id; })));
      else return;
      render();
    });
    addEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-add]'); if (!b) return;
      var mine = V.places.get(); if (mine.length >= 12) return;
      V.places.set(mine.concat([b.getAttribute('data-add')])); render();
    });
    search.addEventListener('input', renderAdd);
    places().then(function (list) { all = list; render(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initMap(); initAlerts(); initRoute(); initPlaces();
  });
})();
