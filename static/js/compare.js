/* ==========================================================================
   Omi AI — Regional Comparison page (/api/compare)
   ========================================================================== */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('compare-root');
    if (!root) return;
    var R = window.OmiResults;
    var UI = window.OmiUI;

    var form = document.getElementById('compare-form');
    var variable = document.getElementById('cmp-variable');
    var start = document.getElementById('cmp-start');
    var end = document.getElementById('cmp-end');
    var detail = document.getElementById('cmp-detail');
    var btn = document.getElementById('compare-btn');
    var status = document.getElementById('compare-status');
    var results = document.getElementById('compare-results');
    var chart = document.getElementById('compare-chart');
    var mode = 'annual';
    var current = null;
    var currentParams = null;
    var coverage = { start_year: 1981, end_year: 2025, min_years: 5 };
    var COLORS = { lagos: '#168C83', edo: '#C2410C' };

    function setStatus(type, text) {
      if (!text) { status.className = 'notice is-hidden'; return; }
      status.className = 'notice notice-' + type;
      status.textContent = text;
    }

    function differenceConfig(result) {
      var u = UI.unitsFor(result.variable.id);
      var a = result.regions[0];
      var b = result.regions[1];
      var byYear = {};
      b.annual_series.forEach(function (p) { byYear[p.year] = p.value; });
      var points = a.annual_series.filter(function (p) { return byYear[p.year] !== undefined; }).map(function (p) {
        return { label: String(p.year), value: u.toRate(p.value - byYear[p.year]) };
      });
      var zero = points.map(function (p) { return { label: p.label, value: 0 }; });
      return {
        unit: u.level,
        legend: true,
        series: [
          { name: a.region.name + ' minus ' + b.region.name, color: '#334E68', points: points },
          { name: 'No difference', color: '#9FB3C8', dashed: true, showPoints: false, points: zero }
        ]
      };
    }

    function drawChart() {
      if (!current) return;
      var cfg = mode === 'difference' ? differenceConfig(current) : R.chartConfig(current, mode === 'monthly' ? 'monthly' : 'annual');
      UI.renderChart(chart, cfg);
    }

    function cardsHtml(result) {
      var u = UI.unitsFor(result.variable.id);
      var digits = u.level === 'mm/year' ? 0 : 2;
      var faster = result.comparison.faster_change;
      return result.regions.map(function (r) {
        var t = r.trend;
        var isFaster = faster === r.region.name;
        return '<article class="card compare-card" style="--accent:' + (COLORS[r.region.id] || '#168C83') + '">' +
          '<div class="compare-card-head"><span class="region-dot" style="--dot:' + (COLORS[r.region.id] || '#168C83') + '"></span>' +
          '<h3>' + UI.escapeHtml(r.region.name) + '</h3>' + (isFaster ? '<span class="sig-badge is-significant">Faster change</span>' : '') + '</div>' +
          '<div class="compare-card-rate">' + UI.formatNumber(u.toRate(t.sens_slope.slope_per_decade), digits, true) + ' <span>' + UI.escapeHtml(u.rate) + '</span></div>' +
          '<div class="compare-card-meta">' + UI.escapeHtml(t.direction) + ' · Mann-Kendall p ' + UI.formatP(t.mann_kendall.p_value) + ' · ' +
          (t.significant ? 'significant' : 'not significant') + '</div>' +
          '<div class="compare-card-meta">Yearly average ' + UI.formatNumber(u.toLevel(r.statistics.mean), digits) + ' ' + UI.escapeHtml(u.level) + '</div>' +
        '</article>';
      }).join('') +
      '<article class="card compare-card compare-card-verdict">' +
        '<div class="compare-card-head"><h3>Verdict</h3></div>' +
        '<div class="compare-card-rate">' + (result.comparison.same_direction ? 'Same direction' : 'Opposite directions') + '</div>' +
        '<div class="compare-card-meta">' + (faster ? UI.escapeHtml(faster) + ' changed faster.' : 'Both changed at a similar rate.') + '</div>' +
      '</article>';
    }

    function render(result) {
      current = result;
      results.classList.remove('is-hidden');
      document.getElementById('compare-cards').innerHTML = cardsHtml(result);
      document.getElementById('compare-chart-title').textContent = R.title(result);
      document.getElementById('compare-explanation').innerHTML = R.explanationHtml(result.explanation);
      document.getElementById('compare-table').innerHTML = R.comparisonHtml(result);
      document.getElementById('compare-stats').innerHTML = R.statsHtml(result);
      document.getElementById('compare-source').innerHTML = R.sourceHtml(result);
      drawChart();
    }

    function run() {
      var params = {
        variable: variable.value,
        start_year: Number(start.value),
        end_year: Number(end.value),
        detail: detail.value,
        alpha: UI.getPreferences().alpha,
        regions: ['lagos', 'edo']
      };
      if (!Number.isInteger(params.start_year) || !Number.isInteger(params.end_year) ||
          params.start_year < coverage.start_year || params.end_year > coverage.end_year ||
          params.end_year - params.start_year + 1 < coverage.min_years) {
        setStatus('warning', 'Choose at least ' + coverage.min_years + ' years between ' + coverage.start_year + ' and ' + coverage.end_year + '.');
        return;
      }
      currentParams = params;
      btn.disabled = true;
      setStatus('info', 'Analysing both regions with NASA POWER data…');
      fetch(root.getAttribute('data-compare-endpoint'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(params)
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
            return data;
          });
        })
        .then(function (data) { setStatus(null); render(data); })
        .catch(function (err) { setStatus('error', 'The comparison could not be completed: ' + err.message); })
        .finally(function () { btn.disabled = false; });
    }

    form.addEventListener('submit', function (event) { event.preventDefault(); run(); });

    document.querySelectorAll('[data-cmp-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.getAttribute('data-cmp-mode');
        document.querySelectorAll('[data-cmp-mode]').forEach(function (o) {
          o.classList.toggle('is-active', o === b);
          o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
        });
        drawChart();
      });
    });

    document.getElementById('compare-ask-btn').addEventListener('click', function (event) {
      if (!currentParams) return;
      event.preventDefault();
      try {
        sessionStorage.setItem('omi_pending_investigation', JSON.stringify({
          params: {
            regions: ['lagos', 'edo'], compare: true, variable: currentParams.variable,
            start_year: currentParams.start_year, end_year: currentParams.end_year, source: 'power'
          },
          detail: currentParams.detail
        }));
      } catch (e) {}
      window.location.href = root.getAttribute('data-assistant-url') + '?from=compare';
    });

    fetch(root.getAttribute('data-coverage-endpoint'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data) {
          coverage = data;
          [start, end].forEach(function (i) { i.min = data.start_year; i.max = data.end_year; });
          start.value = data.start_year;
          end.value = data.end_year;
        }
      })
      .catch(function () {})
      .finally(run);
  });
})();
