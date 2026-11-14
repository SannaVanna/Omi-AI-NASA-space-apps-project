/* ==========================================================================
   Omi AI — live weather card on the dashboard (GET /api/weather)
   Shows only what the API returns; on failure it says so instead of
   showing placeholder numbers.
   ========================================================================== */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('weather-hero');
    if (!root) return;
    var endpoint = root.getAttribute('data-endpoint') || '/api/weather';
    var imgBase = root.getAttribute('data-img-base') || '/static/img/weather/';
    var esc = window.OmiUI ? window.OmiUI.escapeHtml : function (v) { return String(v); };
    var region = 'lagos';
    var cache = {};

    var el = {
      temp: document.getElementById('wx-temp'),
      cond: document.getElementById('wx-cond'),
      icon: document.getElementById('wx-icon'),
      humidity: document.getElementById('wx-humidity'),
      wind: document.getElementById('wx-wind'),
      alert: document.getElementById('wx-alert'),
      alertText: document.getElementById('wx-alert-text'),
      hours: document.getElementById('wx-hours'),
      source: document.getElementById('wx-source'),
      greeting: document.getElementById('wx-greeting')
    };

    function timeLabel(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' });
    }

    function render(data) {
      var c = data.current;
      el.temp.textContent = c.temperature;
      el.cond.textContent = c.condition;
      el.icon.src = imgBase + c.icon + '.svg';
      el.icon.alt = c.condition;
      el.humidity.textContent = c.humidity === null ? '—' : c.humidity + '%';
      el.wind.textContent = c.wind_kmh === null ? '—' : c.wind_kmh + ' km/h';

      var rainSoon = data.alert && data.alert.minutes !== null;
      el.alert.classList.toggle('is-rain', !!rainSoon);
      el.alertText.textContent = data.alert ? data.alert.text : '';

      el.hours.innerHTML = (data.hourly || []).map(function (h) {
        return '<div class="wx-hour" title="' + esc(h.condition) + '">' +
          '<span class="wx-hour-label">' + esc(h.label) + '</span>' +
          '<img src="' + imgBase + esc(h.icon) + '.svg" alt="' + esc(h.condition) + '" width="44" height="50">' +
          '<span class="wx-hour-temp">' + esc(h.temperature) + '°</span>' +
        '</div>';
      }).join('');

      var name = data.region.name;
      el.greeting.textContent = rainSoon
        ? 'Heads up: ' + data.alert.text.toLowerCase() + ' in ' + name + '.'
        : "Here's your weather update for " + name + '.';

      el.source.innerHTML = 'Live forecast · <a href="' + esc(data.source.url) + '" target="_blank" rel="noopener">' + esc(data.source.name) + '</a>' +
        (data.updated ? ' · updated ' + esc(timeLabel(data.updated)) : '') +
        (data.stale ? ' · <span class="wx-stale">showing last available forecast</span>' : '');
      root.classList.remove('is-error');
    }

    function showError() {
      root.classList.add('is-error');
      el.cond.textContent = 'Live weather is unavailable right now';
      el.temp.textContent = '--';
      el.alertText.textContent = 'Try again in a few minutes.';
      el.hours.innerHTML = '';
      el.source.textContent = 'Climate trends below still work — they use NASA POWER records.';
    }

    function load(id) {
      region = id;
      document.querySelectorAll('[data-wx-region]').forEach(function (b) {
        var on = b.getAttribute('data-wx-region') === id;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (cache[id] && Date.now() - cache[id].at < 10 * 60 * 1000) {
        render(cache[id].data);
        return;
      }
      root.classList.add('is-loading');
      fetch(endpoint + '?region=' + encodeURIComponent(id), { headers: { 'Accept': 'application/json' } })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
            return data;
          });
        })
        .then(function (data) {
          cache[id] = { at: Date.now(), data: data };
          if (region === id) render(data);
        })
        .catch(showError)
        .finally(function () { root.classList.remove('is-loading'); });
    }

    document.querySelectorAll('[data-wx-region]').forEach(function (b) {
      b.addEventListener('click', function () { load(b.getAttribute('data-wx-region')); });
    });

    // Follow the dashboard's Location menu when a single region is chosen.
    var regionSelect = document.getElementById('inv-region');
    if (regionSelect) {
      regionSelect.addEventListener('change', function () {
        if (regionSelect.value === 'lagos' || regionSelect.value === 'edo') load(regionSelect.value);
      });
    }

    var initial = regionSelect && (regionSelect.value === 'edo') ? 'edo' : 'lagos';
    load(initial);
    // Refresh every 15 minutes while the page stays open.
    setInterval(function () { cache = {}; load(region); }, 15 * 60 * 1000);
  });
})();
