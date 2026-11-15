/* ==========================================================================
   Omi AI v2 dashboard: mode-adaptive climate story, mini rain radar,
   Omi's weather mood and alert summary. All numbers come from the API.
   ========================================================================== */
(function () {
  'use strict';

  var V = window.OmiV2, C = window.OmiCharts;
  var esc = V.esc;
  var state = { region: 'lagos', variable: 'temperature', cache: {}, result: null };

  // ------------------------------------------------------------ helpers
  function fmt(n, d) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d == null ? 2 : d); }
  function pFmt(p) {
    if (p == null || isNaN(p)) return '—';
    if (p < 0.001) return p.toExponential(1).replace('e-', ' × 10⁻').replace(/⁻(\d+)/, function (m, d) { return '⁻' + d.split('').map(function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]; }).join(''); });
    return p.toFixed(3);
  }
  var REGION_NAME = { lagos: 'Lagos', edo: 'Edo' };

  function story(r) {
    var t = r.trend, sen = t.sens_slope, perDec = sen.slope_per_decade, years = r.period.years;
    var total = sen.slope_per_year * (years - 1);
    var temp = r.variable.id === 'temperature';
    var sig = t.significant;
    var word = !sig ? (temp ? 'has no clear temperature trend' : 'has no clear rainfall trend')
      : temp ? (perDec > 0 ? 'is getting warmer' : 'is getting cooler')
      : (perDec > 0 ? 'is getting wetter' : 'is getting drier');
    return { perDec: perDec, total: total, sig: sig, word: word, temp: temp, unit: temp ? '°C' : 'mm' };
  }

  function points(r) {
    return r.annual_series.map(function (p) { return { x: p.year || +String(p.date).slice(0, 4), y: p.value }; });
  }
  function trendPts(r) {
    return (r.trend.trend_line || []).map(function (p) { return { x: +String(p.date).slice(0, 4), y: p.value }; });
  }
  function senBand(r) {
    var pts = points(r), sen = r.trend.sens_slope, ci = sen.confidence_interval_per_year;
    if (!ci) return null;
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; }).slice().sort(function (a, b) { return a - b; });
    var xm = (xs[0] + xs[xs.length - 1]) / 2, ym = ys[Math.floor(ys.length / 2)];
    var line = function (slope) { return [xs[0], xs[xs.length - 1]].map(function (x) { return { x: x, y: ym + slope * (x - xm) }; }); };
    var a = line(ci[0]), b = line(ci[1]);
    return { lo: [{ x: a[0].x, y: Math.min(a[0].y, b[0].y) }, { x: a[1].x, y: Math.min(a[1].y, b[1].y) }], hi: [{ x: a[0].x, y: Math.max(a[0].y, b[0].y) }, { x: a[1].x, y: Math.max(a[1].y, b[1].y) }], color: '#2563EB' };
  }

  // ------------------------------------------------------------ climate card
  function renderClimate() {
    var body = document.querySelector('[data-climate-body]');
    var r = state.result;
    if (!body || !r) return;
    var mode = V.mode(), s = story(r), name = REGION_NAME[state.region] || r.region.name;
    var color = s.temp ? '#F08C00' : '#0EA5A0';
    var unitDec = s.unit + ' per decade';
    var html = '';

    if (mode === 'simple') {
      html += '<div class="climate-statement ' + (s.temp ? 'is-warm' : 'is-wet') + '">' +
        '<div><strong>' + esc(name) + ' ' + esc(s.word) + '</strong>' +
        '<span class="' + (s.sig ? 'ok' : 'unsure') + '">' + (s.sig ? '✓ Very confident: a real trend, not chance' : '≈ Not sure: could be natural ups and downs') + '</span></div>' +
        '<b>' + (s.sig ? fmt(s.total, s.temp ? 1 : 0) + s.unit : '±0') + '</b></div>' +
        '<div class="climate-chart" data-chart></div>' +
        '<div class="climate-axis"><span>' + r.period.start_year + '</span><span>' + (s.temp ? 'Average temperature each year' : 'Total rain each year') + ' (NASA)</span><span>' + r.period.end_year + '</span></div>' +
        '<div class="climate-facts">' +
          '<div class="stat-tile"><span class="value">' + (s.temp ? '🌡️ ' : '🌧️ ') + fmt(s.perDec, s.temp ? 2 : 0) + ' ' + s.unit + '</span><span class="sub">every 10 years</span></div>' +
          '<div class="stat-tile"><span class="value">📅 ' + r.period.years + ' years</span><span class="sub">of NASA satellite-era records</span></div>' +
        '</div>';
    } else if (mode === 'learn') {
      html += '<div class="climate-chart" data-chart></div>' +
        '<div class="climate-legend"><span><i style="background:' + color + '"></i>Yearly value</span><span><i class="dash"></i>Trend line (Sen\'s slope)</span></div>' +
        '<p class="climate-summary">' + esc(r.summary) + '</p>' +
        '<details class="climate-learn"><summary>📘 How does Omi know it\'s a real trend?</summary>' +
        '<p>Omi uses the <b>Mann-Kendall test</b>, which checks whether values tend to go up (or down) over time more often than chance would allow. The <b>p-value</b> is the chance of seeing a pattern this strong if there were no real trend: below 0.05 means "significant". The trend line uses <b>Sen\'s slope</b>, the median of all year-to-year slopes, so one unusual year can\'t pull it around.</p></details>';
    } else {
      var t = r.trend, mk = t.mann_kendall, lr = t.linear_regression, sen = t.sens_slope, ci = sen.confidence_interval_per_year || [NaN, NaN];
      var smk = r.seasonal_check || t.seasonal_mann_kendall;
      var rows = [
        ["Sen's slope", fmt(sen.slope_per_decade, 3) + ' ' + unitDec],
        ['95% CI (Sen)', '[' + (ci[0] * 10).toFixed(3) + ', ' + (ci[1] * 10).toFixed(3) + ']'],
        ['Mann-Kendall Z', mk.z != null ? mk.z.toFixed(2) : '—'],
        ["Kendall's τ", mk.tau != null ? mk.tau.toFixed(3) : '—'],
        ['p-value', pFmt(mk.p_value)],
        ['OLS slope · R²', fmt(lr.slope_per_decade, 3) + ' · ' + lr.r_squared.toFixed(3)],
        ['Seasonal MK', smk && smk.z != null ? 'Z = ' + smk.z.toFixed(2) + ', ' + esc(smk.trend) : '—'],
        ['n (years)', String(t.observations)]
      ];
      html += '<div class="research-grid"><div><div class="climate-chart" data-chart></div>' +
        '<div class="climate-legend"><span><i style="background:#2563EB"></i>Observed</span><span><i style="background:#0B1F44"></i>Sen\'s slope</span><span><i style="background:#BFD3FF"></i>95% CI</span></div></div>' +
        '<table class="stats-table"><caption class="sr-only">Trend test results</caption><tbody>' +
        rows.map(function (rw) { return '<tr><th scope="row">' + rw[0] + '</th><td>' + rw[1] + '</td></tr>'; }).join('') +
        '</tbody></table></div>' +
        '<p class="research-method">' + esc(mk.test || 'Mann-Kendall') + '; Theil–Sen estimator with 95% CI; α = ' + t.alpha + '. Source: ' + esc(r.source && r.source.name || 'NASA POWER') + '. ' +
        '<span class="pill ' + (t.significant ? 'pill--success' : '') + '">' + (t.significant ? 'Significant ' + (sen.slope_per_decade > 0 ? '↑' : '↓') : 'Not significant') + '</span></p>' +
        '<div class="research-actions"><button type="button" class="btn btn-secondary btn-sm" data-export-csv>Export CSV</button>' +
        '<a class="btn btn-secondary btn-sm" href="/compare">Compare regions</a><a class="btn btn-primary btn-sm" href="/upload">Open Data Lab</a></div>';
    }
    body.innerHTML = html;

    var chartEl = body.querySelector('[data-chart]');
    var series = [{ points: points(r), color: mode === 'research' ? '#2563EB' : color, width: mode === 'simple' ? 2.6 : 2, dots: mode === 'research' }];
    var tp = trendPts(r);
    if (tp.length) series.push({ points: tp, color: mode === 'research' ? '#0B1F44' : (s.temp ? '#D9480F' : '#0F766E'), width: 2.2, dash: mode !== 'research' });
    C.line(chartEl, {
      series: series, area: mode === 'simple', band: mode === 'research' ? senBand(r) : null,
      height: mode === 'simple' ? 170 : 220, minimal: mode === 'simple', yUnit: s.unit,
      label: (s.temp ? 'Annual mean temperature' : 'Annual rainfall') + ' in ' + name + ', ' + r.period.start_year + '–' + r.period.end_year
    });
    var exp = body.querySelector('[data-export-csv]');
    if (exp) exp.addEventListener('click', function () {
      var csv = 'year,value,unit\n' + r.annual_series.map(function (p) { return (p.year || p.date) + ',' + p.value + ',' + (r.units.annual || ''); }).join('\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'omi_' + state.region + '_' + state.variable + '_annual.csv';
      a.click();
    });
  }

  function loadClimate() {
    var body = document.querySelector('[data-climate-body]');
    var key = state.region + ':' + state.variable;
    document.querySelectorAll('[data-climate-region]').forEach(function (n) { n.textContent = REGION_NAME[state.region]; });
    if (state.cache[key]) { state.result = state.cache[key]; renderClimate(); return; }
    if (body) body.innerHTML = '<div class="skeleton" style="height: 220px;"></div>';
    fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ region: state.region, variable: state.variable, detail: 'research' })
    }).then(function (res) { return res.json().then(function (d) { if (!res.ok) throw new Error(d.error || 'HTTP ' + res.status); return d; }); })
      .then(function (d) { state.cache[key] = d; if (key === state.region + ':' + state.variable) { state.result = d; renderClimate(); } })
      .catch(function (e) { if (body) body.innerHTML = '<p class="muted">NASA records could not be loaded right now (' + esc(e.message) + ').</p>'; });
  }

  // ------------------------------------------------------------ radar
  function imergTime() {
    var d = new Date(Date.now() - 6 * 3600 * 1000);
    d.setUTCMinutes(d.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
    return d.toISOString().slice(0, 19) + 'Z';
  }
  function miniRadar() {
    var elm = document.getElementById('mini-radar');
    if (!elm || !window.L) return;
    var map = L.map(elm, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false }).setView([8.9, 8.2], 5);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri', maxZoom: 16 }).addTo(map);
    var t = imergTime();
    L.tileLayer('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/' + t + '/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png', { opacity: 0.85, maxNativeZoom: 6, attribution: 'NASA GIBS · GPM IMERG' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);
    var note = document.querySelector('[data-radar-time]');
    if (note) note.textContent = 'NASA GPM IMERG · ' + new Date(t).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) + ' WAT (latest available)';
  }

  // ------------------------------------------------------------ mood + alerts
  var MOOD_TEXT = {
    sunny: 'Sunny and bright. Stay hydrated and seek shade at midday.',
    cloudy: 'Cloudy skies. A comfortable day to get things done.',
    rainy: 'Rain around. Keep an umbrella close and avoid flooded roads.',
    stormy: 'Storms possible. Stay indoors during lightning.',
    harmattan: 'Harmattan haze. Protect your eyes and skin, and drive slowly.'
  };
  function onWeather(e) {
    var d = e.detail;
    if (!d) return;
    V.setMood(document.getElementById('dash-omi-mood'), d.mood);
    var t = document.querySelector('[data-mood-text]');
    if (t) t.textContent = (d.alert && d.alert.minutes !== null ? d.alert.text + '. ' : '') + (MOOD_TEXT[d.mood] || '');
    if (d.region && REGION_NAME[d.region.id] && d.region.id !== state.region) { state.region = d.region.id; loadClimate(); }
  }
  function alertsPill() {
    var pill = document.querySelector('[data-dash-alerts]');
    if (!pill) return;
    V.loadAlerts().then(function (data) {
      var n = data.alerts.length, urgent = data.counts.severe + data.counts.warning;
      pill.textContent = n ? '⚠ ' + n + ' active alert' + (n > 1 ? 's' : '') : '✓ No alerts for your places';
      pill.className = 'pill ' + (urgent ? 'pill--warning' : n ? 'pill--brand' : 'pill--success');
    }).catch(function () { pill.textContent = 'Alerts unavailable'; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('[data-dash]')) return;
    var h = new Date().toLocaleString('en-NG', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' });
    var g = document.querySelector('[data-greeting-time]');
    if (g) g.textContent = +h < 12 ? 'Good morning' : +h < 17 ? 'Good afternoon' : 'Good evening';

    document.querySelectorAll('[data-climate-var]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.variable = b.getAttribute('data-climate-var');
        document.querySelectorAll('[data-climate-var]').forEach(function (x) { var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on); });
        loadClimate();
      });
    });
    document.addEventListener('omi:weather', onWeather);
    document.addEventListener('omi:mode', function (e) {
      renderClimate();
      var sel = document.getElementById('inv-detail');
      if (sel) sel.value = { simple: 'simple', learn: 'detailed', research: 'research' }[e.detail] || 'detailed';
    });
    var sel = document.getElementById('inv-detail');
    if (sel) sel.value = { simple: 'simple', learn: 'detailed', research: 'research' }[V.mode()] || 'detailed';

    var reveal = document.querySelector('[data-reveal-explore]');
    var area = document.getElementById('explore-area');
    if (reveal && area) {
      reveal.addEventListener('click', function () {
        var open = area.classList.toggle('is-open');
        reveal.setAttribute('aria-expanded', open);
        reveal.textContent = open ? 'Hide the explorer' : 'Show the explorer';
        if (open && window.dispatchEvent) setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 50);
      });
    }
    var exploreBtn = document.getElementById('explore-trends-btn');
    if (exploreBtn && area) exploreBtn.addEventListener('click', function () {
      if (!area.classList.contains('is-open') && reveal) reveal.click();
    }, true);
    var resizeT;
    window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(renderClimate, 200); });

    loadClimate();
    miniRadar();
    alertsPill();
  });
})();
