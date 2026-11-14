/* ==========================================================================
   Omi AI — Environmental Dashboard Logic
   Runs investigations through the Flask analysis engine (/api/analyze and
   /api/compare) and renders only what the backend returns.
   ========================================================================== */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('dashboard-root');
    if (!root) return;

    var analyzeEndpoint = root.getAttribute('data-analyze-endpoint') || '/api/analyze';
    var compareEndpoint = root.getAttribute('data-compare-endpoint') || '/api/compare';
    var coverageEndpoint = root.getAttribute('data-coverage-endpoint') || '/api/coverage';
    var assistantUrl = root.getAttribute('data-assistant-url') || '/assistant';

    var form = document.getElementById('investigation-form');
    var regionSelect = document.getElementById('inv-region');
    var variableSelect = document.getElementById('inv-variable');
    var startInput = document.getElementById('inv-start');
    var endInput = document.getElementById('inv-end');
    var detailSelect = document.getElementById('inv-detail');
    var sourceSelect = document.getElementById('inv-source');
    var sources = { power: { start_year: 1981, available: true, variables: ['temperature', 'rainfall'], name: 'NASA POWER (MERRA-2)' } };
    var submitBtn = document.getElementById('investigate-btn');
    var coverageNote = document.getElementById('coverage-note');

    var statusBanner = document.getElementById('dashboard-status-banner');
    var activeLabel = document.getElementById('overview-active-region');
    var emptyState = document.getElementById('results-empty');
    var panel = document.getElementById('results-panel');
    var kpis = document.getElementById('results-kpis');
    var chart = document.getElementById('results-chart');
    var chartTitle = document.getElementById('chart-title');
    var chartSubtitle = document.getElementById('chart-subtitle');
    var explanation = document.getElementById('results-explanation');
    var explanationMeta = document.getElementById('explanation-meta');
    var statsBox = document.getElementById('results-stats');
    var comparisonCard = document.getElementById('comparison-card');
    var comparisonBody = document.getElementById('comparison-panel-body');
    var sourceBox = document.getElementById('results-source');

    var coverage = { start_year: 1981, end_year: 2025, min_years: 5 };
    var current = null;
    var currentParams = null;
    var chartMode = 'annual';

    function setBanner(type, message) {
      if (!statusBanner) return;
      if (!message) {
        statusBanner.className = 'notice is-hidden';
        return;
      }
      statusBanner.className = 'notice notice-' + type;
      statusBanner.textContent = message;
    }

    function prefs() {
      return window.OmiUI.getPreferences();
    }

    function sourceInfo() {
      var id = sourceSelect ? sourceSelect.value : 'power';
      return sources[id] || sources.power;
    }

    function firstYear() {
      return Math.max(coverage.start_year, sourceInfo().start_year || coverage.start_year);
    }

    function syncSourceOptions() {
      if (!sourceSelect) return;
      var variable = variableSelect ? variableSelect.value : 'temperature';
      Array.prototype.forEach.call(sourceSelect.options, function (opt) {
        var info = sources[opt.value];
        var usable = info && info.available && info.variables.indexOf(variable) !== -1;
        opt.disabled = !usable;
        var base = info ? info.name : opt.textContent;
        if (info && !info.available) base += ' — needs Earthdata token';
        else if (info && info.variables.indexOf(variable) === -1) base += ' — rainfall only';
        opt.textContent = base;
      });
      if (sourceSelect.selectedOptions[0] && sourceSelect.selectedOptions[0].disabled) sourceSelect.value = 'power';
      var min = firstYear();
      if (startInput) {
        startInput.min = min;
        if (Number(startInput.value) < min) startInput.value = min;
      }
      if (endInput) endInput.min = min;
      if (coverageNote) {
        coverageNote.textContent = sourceInfo().name + ' records are available from ' + min + ' to ' + coverage.end_year +
          '. Choose at least ' + coverage.min_years + ' years.';
      }
    }

    function applyCoverage(data) {
      coverage = data;
      (data.sources || []).forEach(function (src) { sources[src.id] = src; });
      [startInput, endInput].forEach(function (input) {
        if (!input) return;
        input.min = data.start_year;
        input.max = data.end_year;
      });
      if (startInput && !startInput.dataset.touched) startInput.value = data.start_year;
      if (endInput && !endInput.dataset.touched) endInput.value = data.end_year;
      syncSourceOptions();
    }

    function validate(params) {
      var start = Number(params.start_year);
      var end = Number(params.end_year);
      if (!Number.isInteger(start) || !Number.isInteger(end)) return 'Please enter whole years.';
      if (start < firstYear() || end > coverage.end_year) {
        return 'Choose years between ' + firstYear() + ' and ' + coverage.end_year + ' for ' + sourceInfo().name + '.';
      }
      if (start > end) return 'The start year must be before the end year.';
      if (end - start + 1 < coverage.min_years) return 'Choose at least ' + coverage.min_years + ' years so a trend can be tested.';
      return null;
    }

    function readParams() {
      return {
        region: regionSelect ? regionSelect.value : 'lagos',
        variable: variableSelect ? variableSelect.value : 'temperature',
        start_year: startInput ? Number(startInput.value) : coverage.start_year,
        end_year: endInput ? Number(endInput.value) : coverage.end_year,
        detail: detailSelect ? detailSelect.value : 'detailed',
        source: sourceSelect ? sourceSelect.value : 'power',
        alpha: prefs().alpha
      };
    }

    function drawChart() {
      if (!current || !chart) return;
      window.OmiUI.renderChart(chart, window.OmiResults.chartConfig(current, chartMode));
      if (chartSubtitle) {
        chartSubtitle.textContent = chartMode === 'annual'
          ? 'One value per year with the fitted linear trend (dashed)'
          : 'Monthly NASA POWER values showing the seasonal cycle';
      }
    }

    function render(result, params) {
      current = result;
      currentParams = params;
      var R = window.OmiResults;

      if (emptyState) emptyState.classList.add('is-hidden');
      if (panel) panel.classList.remove('is-hidden');
      if (activeLabel) activeLabel.textContent = R.title(result);
      if (chartTitle) chartTitle.textContent = R.title(result);
      if (kpis) kpis.innerHTML = R.kpiHtml(result);
      drawChart();
      if (explanation) explanation.innerHTML = R.explanationHtml(result.explanation);
      if (explanationMeta) {
        explanationMeta.textContent = ({ simple: 'Simple', detailed: 'Detailed', research: 'Research-level' })[result.detail] +
          ' explanation built from the calculated results';
      }
      var insight = document.getElementById('results-insight');
      if (insight) insight.textContent = result.summary || '';
      if (statsBox) statsBox.innerHTML = R.statsHtml(result);
      if (comparisonCard) comparisonCard.classList.toggle('is-hidden', !R.isComparison(result));
      if (comparisonBody) comparisonBody.innerHTML = R.comparisonHtml(result);
      if (sourceBox) sourceBox.innerHTML = R.sourceHtml(result);

      document.querySelectorAll('[data-region-status]').forEach(function (el) {
        el.textContent = (result.source && result.source.source_id === 'imerg') || (result.regions && result.regions[0].source.source_id === 'imerg')
          ? 'NASA GPM IMERG' : 'NASA POWER · MERRA-2';
      });
    }

    function investigate(params) {
      var problem = validate(params);
      if (problem) {
        setBanner('warning', problem);
        return;
      }

      var compare = params.region === 'both';
      var body = {
        variable: params.variable,
        start_year: params.start_year,
        end_year: params.end_year,
        detail: params.detail,
        source: params.source,
        alpha: params.alpha
      };
      if (compare) {
        body.regions = ['lagos', 'edo'];
      } else {
        body.region = params.region;
      }

      highlightRegion(params.region, true);

      if (submitBtn) submitBtn.disabled = true;
      setBanner('info', 'Retrieving ' + sourceInfo().name + ' records and running the trend analysis… (the first request for a region can take a few seconds)');

      fetch(compare ? compareEndpoint : analyzeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) throw new Error(data.error || ('The server returned HTTP ' + res.status));
            return data;
          });
        })
        .then(function (data) {
          setBanner(null);
          render(data, params);
          var overview = document.getElementById('environmental-overview');
          if (overview) overview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        })
        .catch(function (err) {
          setBanner('error', 'The investigation could not be completed: ' + err.message);
        })
        .finally(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
    }

    function highlightRegion(key, fly) {
      document.querySelectorAll('[data-region-card]').forEach(function (card) {
        var id = card.getAttribute('data-region-card');
        card.classList.toggle('is-selected', key === 'both' || id === key);
      });
      if (window.OmiMap) window.OmiMap.select(key, { fly: !!fly });
    }

    if (regionSelect) {
      regionSelect.addEventListener('change', function () { highlightRegion(regionSelect.value, true); });
    }

    // Map -> form: clicking a marker selects the region; popup buttons run the analysis.
    if (window.OmiMap) {
      window.OmiMap.onSelect(function (key) {
        if (regionSelect) regionSelect.value = key;
        highlightRegion(key, false);
      });
    }
    document.addEventListener('omi:map-analyse', function (event) {
      var key = event.detail && event.detail.region;
      if (!key || !regionSelect) return;
      regionSelect.value = key;
      investigate(readParams());
    });

    var compareBtn = document.getElementById('map-compare-btn');
    if (compareBtn) {
      compareBtn.addEventListener('click', function () {
        if (regionSelect) regionSelect.value = 'both';
        investigate(readParams());
      });
    }

    document.querySelectorAll('[data-scroll-map]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        if (regionSelect) regionSelect.value = 'both';
        highlightRegion('both', true);
        var target = document.getElementById('study-regions');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        investigate(readParams());
      });
    }

    [startInput, endInput].forEach(function (input) {
      if (input) input.addEventListener('input', function () { input.dataset.touched = '1'; });
    });
    if (variableSelect) variableSelect.addEventListener('change', syncSourceOptions);
    if (sourceSelect) sourceSelect.addEventListener('change', syncSourceOptions);

    document.querySelectorAll('[data-analyse-region]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-analyse-region');
        if (regionSelect && key) regionSelect.value = key;
        investigate(readParams());
      });
    });

    document.querySelectorAll('[data-chart-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        chartMode = btn.getAttribute('data-chart-mode');
        document.querySelectorAll('[data-chart-mode]').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        drawChart();
      });
    });

    document.querySelectorAll('[data-ask-omi]').forEach(function (askBtn) {
      askBtn.addEventListener('click', function (event) {
        if (!currentParams) return;
        event.preventDefault();
        var compare = currentParams.region === 'both';
        try {
          sessionStorage.setItem('omi_pending_investigation', JSON.stringify({
            params: {
              regions: compare ? ['lagos', 'edo'] : [currentParams.region],
              compare: compare,
              variable: currentParams.variable,
              start_year: currentParams.start_year,
              end_year: currentParams.end_year,
              source: currentParams.source
            },
            detail: currentParams.detail
          }));
        } catch (e) {}
        window.location.href = assistantUrl + '?from=dashboard';
      });
    });

    var exploreBtn = document.getElementById('explore-trends-btn');
    if (exploreBtn) {
      exploreBtn.addEventListener('click', function () {
        var target = document.getElementById('study-regions');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }

    // Default region from Settings, or ?region=lagos|edo|both from the landing page.
    var preferred = prefs().default_region;
    var params = new URLSearchParams(window.location.search);
    var preselected = params.get('region');
    if (regionSelect) {
      if (['lagos', 'edo', 'both'].indexOf(preselected) !== -1) regionSelect.value = preselected;
      else if (['lagos', 'edo', 'both'].indexOf(preferred) !== -1) regionSelect.value = preferred;
      highlightRegion(regionSelect.value, false);
    }

    fetch(coverageEndpoint, { headers: { 'Accept': 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { if (data) applyCoverage(data); })
      .catch(function () {})
      .finally(function () {
        if (['lagos', 'edo', 'both'].indexOf(preselected) !== -1) investigate(readParams());
      });
  });
})();
