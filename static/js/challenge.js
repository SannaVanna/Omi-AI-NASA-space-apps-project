/* ==========================================================================
   Omi AI — Trend Detective Challenge
   The answer is decided on the server (Seasonal Mann-Kendall on the full
   record) and only sent after the guess. Score is kept in this browser.
   ========================================================================== */

(function () {
  'use strict';

  var SCORE_KEY = 'omi_challenge_score';

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('challenge-root');
    if (!root) return;
    var UI = window.OmiUI;

    var els = {
      region: document.getElementById('ch-region'),
      variable: document.getElementById('ch-variable'),
      newBtn: document.getElementById('ch-new'),
      reset: document.getElementById('ch-reset'),
      status: document.getElementById('ch-status'),
      meta: document.getElementById('ch-meta'),
      title: document.getElementById('ch-title'),
      count: document.getElementById('ch-count'),
      chart: document.getElementById('ch-chart'),
      question: document.getElementById('ch-question'),
      result: document.getElementById('ch-result'),
      verdict: document.getElementById('ch-verdict'),
      stats: document.getElementById('ch-stats'),
      explanation: document.getElementById('ch-explanation'),
      next: document.getElementById('ch-next')
    };
    var current = null;
    var busy = false;

    function loadScore() {
      try {
        var s = JSON.parse(localStorage.getItem(SCORE_KEY) || '{}');
        return { completed: Number(s.completed) || 0, correct: Number(s.correct) || 0 };
      } catch (e) {
        return { completed: 0, correct: 0 };
      }
    }

    function saveScore(s) {
      try { localStorage.setItem(SCORE_KEY, JSON.stringify(s)); } catch (e) {}
    }

    function renderScore() {
      var s = loadScore();
      document.getElementById('score-completed').textContent = s.completed;
      document.getElementById('score-correct').textContent = s.correct;
      document.getElementById('score-accuracy').textContent = s.completed ? Math.round(100 * s.correct / s.completed) + '%' : '0%';
    }

    function setStatus(type, text) {
      if (!text) { els.status.className = 'notice is-hidden'; return; }
      els.status.className = 'notice notice-' + type;
      els.status.textContent = text;
    }

    function post(url, body) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
          return data;
        });
      });
    }

    function color(c) {
      return c && c.region && c.region.id === 'edo' ? '#C2410C' : '#168C83';
    }

    function drawHidden(c) {
      UI.renderChart(els.chart, {
        unit: c.variable.unit,
        legend: true,
        extraLabels: c.hidden_dates,
        shadeFrom: c.hidden_dates[0],
        shadeLabel: c.hidden_count + ' observations hidden',
        series: [{ name: 'Visible observations', color: color(c), points: c.shown.map(function (p) { return { label: p.date, value: p.value }; }) }]
      });
    }

    function drawRevealed(c, r) {
      var shownDates = {};
      c.shown.forEach(function (p) { shownDates[p.date] = true; });
      UI.renderChart(els.chart, {
        unit: c.variable.unit,
        legend: true,
        shadeFrom: c.hidden_dates[0],
        series: [
          { name: 'Visible observations', color: color(c), points: r.series.filter(function (p) { return shownDates[p.date]; }).map(function (p) { return { label: p.date, value: p.value }; }) },
          { name: 'Revealed observations', color: '#7C3AED', points: r.series.filter(function (p) { return !shownDates[p.date]; }).map(function (p) { return { label: p.date, value: p.value }; }) },
          { name: 'Linear trend', color: '#102A43', dashed: true, showPoints: false, points: r.trend_line.map(function (p) { return { label: p.date, value: p.value }; }) }
        ]
      });
    }

    function loadChallenge() {
      if (busy) return;
      busy = true;
      els.newBtn.disabled = true;
      setStatus(null);
      els.result.classList.add('is-hidden');
      els.question.classList.remove('is-hidden');
      els.question.querySelectorAll('.guess-btn').forEach(function (b) { b.disabled = true; b.classList.remove('is-chosen'); });
      els.meta.textContent = 'Loading a real NASA record…';

      post(root.getAttribute('data-new-endpoint'), { region: els.region.value, variable: els.variable.value })
        .then(function (c) {
          current = c;
          var r = c.region;
          els.meta.innerHTML = '<strong style="color:' + color(c) + '">' + UI.escapeHtml(r.name) + '</strong> · ' +
            r.latitude.toFixed(4) + '° N, ' + r.longitude.toFixed(4) + '° E · ' + UI.escapeHtml(c.source.dataset) + ' (Monthly point · ' + UI.escapeHtml(c.source.parameter) + ')';
          els.title.textContent = c.variable.name + ' Time-Series (' + c.variable.unit + ') · ' + c.period.start.slice(0, 4) + '–' + c.period.end.slice(0, 4);
          els.count.textContent = 'Showing ' + c.shown.length + ' of ' + c.total + ' observations (' + c.hidden_count + ' hidden)';
          drawHidden(c);
          els.question.querySelectorAll('.guess-btn').forEach(function (b) { b.disabled = false; });
        })
        .catch(function (err) {
          setStatus('error', 'Could not load a challenge: ' + err.message);
          els.meta.textContent = 'No challenge loaded';
        })
        .finally(function () {
          busy = false;
          els.newBtn.disabled = false;
        });
    }

    function answer(guess, button) {
      if (!current || busy) return;
      busy = true;
      els.question.querySelectorAll('.guess-btn').forEach(function (b) { b.disabled = true; });
      button.classList.add('is-chosen');

      post(root.getAttribute('data-answer-endpoint'), { challenge_id: current.challenge_id, guess: guess, alpha: UI.getPreferences().alpha })
        .then(function (r) {
          var s = loadScore();
          s.completed += 1;
          if (r.correct) s.correct += 1;
          saveScore(s);
          renderScore();

          drawRevealed(current, r);
          els.count.textContent = 'All ' + r.series.length + ' observations revealed';
          els.question.classList.add('is-hidden');
          els.result.classList.remove('is-hidden');
          var label = { increasing: 'Increasing', decreasing: 'Decreasing', 'no trend': 'No significant trend' };
          els.verdict.className = 'challenge-verdict ' + (r.correct ? 'is-correct' : 'is-wrong');
          els.verdict.innerHTML = (r.correct ? '✓ Correct!' : '✗ Not quite.') +
            ' <span>You said <strong>' + label[r.guess] + '</strong>; the full record shows <strong>' + label[r.answer] + '</strong>.</span>';
          var t = r.test;
          els.stats.innerHTML =
            '<div class="kpi-cell"><div class="kpi-label">Test</div><div class="kpi-value kpi-text">' + UI.escapeHtml(t.name) + '</div></div>' +
            '<div class="kpi-cell"><div class="kpi-label">p-value</div><div class="kpi-value">' + UI.formatP(t.p_value) + '</div></div>' +
            '<div class="kpi-cell"><div class="kpi-label">Kendall\'s tau</div><div class="kpi-value">' + UI.formatNumber(t.tau, 3) + '</div></div>' +
            '<div class="kpi-cell"><div class="kpi-label">Sen\'s slope</div><div class="kpi-value">' + UI.formatNumber(t.sen_slope_per_decade, 3, true) + ' <span class="kpi-unit">' + UI.escapeHtml(t.unit) + ' / decade</span></div></div>';
          els.explanation.textContent = r.explanation;
          current = null;
        })
        .catch(function (err) {
          setStatus('error', err.message);
          els.question.querySelectorAll('.guess-btn').forEach(function (b) { b.disabled = false; b.classList.remove('is-chosen'); });
        })
        .finally(function () { busy = false; });
    }

    els.question.querySelectorAll('.guess-btn').forEach(function (b) {
      b.addEventListener('click', function () { answer(b.getAttribute('data-guess'), b); });
    });
    els.newBtn.addEventListener('click', loadChallenge);
    els.next.addEventListener('click', loadChallenge);
    els.reset.addEventListener('click', function () {
      saveScore({ completed: 0, correct: 0 });
      renderScore();
    });

    renderScore();
    loadChallenge();
  });
})();
