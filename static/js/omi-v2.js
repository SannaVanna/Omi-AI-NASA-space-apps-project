/* ==========================================================================
   Omi AI v2 — shared behaviour on every workspace page:
   insight-mode switch, saved places, live alert badges and Floating Omi.
   ========================================================================== */

(function () {
  'use strict';

  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function store(kind) {
    try { return window[kind]; } catch (e) { return null; }
  }
  function readJSON(kind, key, fallback) {
    var s = store(kind);
    if (!s) return fallback;
    try { var v = JSON.parse(s.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function writeJSON(kind, key, value) {
    var s = store(kind);
    if (!s) return;
    try { s.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  // ---------------------------------------------------------------- places
  var DEFAULT_PLACES = ['lagos', 'edo'];
  var Places = {
    get: function () {
      var list = readJSON('localStorage', 'omi_places', null);
      return Array.isArray(list) && list.length ? list.slice(0, 12) : DEFAULT_PLACES.slice();
    },
    set: function (list) {
      writeJSON('localStorage', 'omi_places', list.slice(0, 12));
      sessionCacheClear();
      document.dispatchEvent(new CustomEvent('omi:places', { detail: list }));
    },
    home: function () { return Places.get()[0]; }
  };

  // --------------------------------------------------------------- moods
  var MOOD_IMG = { stormy: 'omi-stormy', harmattan: 'omi-harmattan' };
  function setMood(el, mood) {
    if (!el || !mood) return;
    el.className = el.className.replace(/omi-mood--(sunny|cloudy|rainy|stormy|harmattan)/, 'omi-mood--' + mood);
    el.setAttribute('data-omi-mood', mood);
    var img = el.querySelector('[data-omi-mood-img]');
    if (img) {
      img.src = img.src.replace(/omi-(wave|stormy|harmattan)\.webp/, (MOOD_IMG[mood] || 'omi-wave') + '.webp');
      img.alt = 'Omi, ' + mood + ' mood';
    }
    var label = el.querySelector('[data-omi-mood-label]');
    if (label) label.textContent = mood.charAt(0).toUpperCase() + mood.slice(1);
  }

  // ---------------------------------------------------------- mode switch
  function initModeSwitch() {
    document.querySelectorAll('[data-mode-switch]').forEach(function (group) {
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-mode]');
        if (!btn) return;
        var mode = btn.getAttribute('data-mode');
        applyMode(mode);
        fetch('/api/profile/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: mode })
        }).catch(function () {});
      });
    });
  }
  function applyMode(mode) {
    document.body.setAttribute('data-mode', mode);
    document.querySelectorAll('[data-mode-switch] [data-mode]').forEach(function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    document.dispatchEvent(new CustomEvent('omi:mode', { detail: mode }));
  }

  // --------------------------------------------------------------- alerts
  var ALERT_TTL = 10 * 60 * 1000;
  function sessionCacheClear() {
    var s = store('sessionStorage');
    if (s) try { s.removeItem('omi_alerts'); } catch (e) {}
  }
  function loadAlerts(force) {
    var places = Places.get();
    var key = places.join(',');
    var cached = readJSON('sessionStorage', 'omi_alerts', null);
    if (!force && cached && cached.key === key && Date.now() - cached.at < ALERT_TTL) return Promise.resolve(cached.data);
    return getJSON('/api/alerts?places=' + encodeURIComponent(key)).then(function (data) {
      writeJSON('sessionStorage', 'omi_alerts', { key: key, at: Date.now(), data: data });
      return data;
    });
  }
  var SEV_ICON = { severe: '⚠️', warning: '🌧️', info: 'ℹ️' };
  function alertItem(a) {
    return '<div class="alert-item alert-item--' + esc(a.severity) + '">' +
      '<span class="alert-item-icon" aria-hidden="true">' + (a.kind === 'heat' ? '🌡️' : a.kind === 'thunder' ? '⛈️' : a.kind === 'harmattan' ? '🌫️' : SEV_ICON[a.severity]) + '</span>' +
      '<span class="alert-item-text"><strong>' + esc(a.title) + '</strong><span>' + esc(a.place) + ' · ' + esc(a.detail) + '</span></span>' +
      '<span class="alert-item-sev">' + esc(a.severity) + '</span></div>';
  }
  function renderBadges(data) {
    var n = (data.counts.severe || 0) + (data.counts.warning || 0);
    var total = data.alerts.length;
    document.querySelectorAll('[data-alert-badge]').forEach(function (b) {
      b.textContent = total;
      b.classList.toggle('is-hidden', !total);
      b.classList.toggle('is-urgent', n > 0);
    });
    document.querySelectorAll('[data-alert-dot]').forEach(function (d) { d.classList.toggle('is-hidden', !total); });
    var list = document.querySelector('[data-notif-list]');
    if (list) {
      list.innerHTML = total
        ? data.alerts.slice(0, 4).map(alertItem).join('')
        : '<p>No weather alerts for your places right now. 🎉</p>';
    }
  }

  // --------------------------------------------------------- floating Omi
  function initFloatingOmi() {
    var root = document.querySelector('[data-fomi]');
    if (!root) return;
    var panel = root.querySelector('.fomi-panel');
    var peek = root.querySelector('.fomi-peek');
    var log = root.querySelector('[data-fomi-log]');
    var form = root.querySelector('[data-fomi-form]');
    var input = root.querySelector('#fomi-input');
    var history = [];
    var context = {};
    var pending = false;

    function open(on) {
      panel.hidden = !on;
      root.classList.toggle('is-open', on);
      peek.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on && input) setTimeout(function () { input.focus(); }, 50);
    }
    root.querySelectorAll('[data-fomi-toggle]').forEach(function (b) {
      b.addEventListener('click', function () { open(panel.hidden); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) open(false); });

    function bubble(who, text) {
      var d = document.createElement('div');
      d.className = 'fomi-msg fomi-msg--' + who;
      d.textContent = text;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
      return d;
    }
    function ask(q) {
      q = String(q || '').trim();
      if (!q || pending) return;
      var sug = log.querySelector('.fomi-suggest');
      if (sug) sug.remove();
      bubble('user', q);
      var wait = bubble('omi', 'Omi is thinking…');
      wait.classList.add('is-pending');
      pending = true;
      fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ question: q, history: history.slice(-6), context: context, detail: document.body.getAttribute('data-mode') === 'research' ? 'research' : document.body.getAttribute('data-mode') === 'simple' ? 'simple' : 'detailed' })
      })
        .then(function (res) { return res.json().then(function (d) { if (!res.ok) throw new Error(d.error || 'HTTP ' + res.status); return d; }); })
        .then(function (d) {
          var reply = d.answer || d.reply || 'Sorry, I have no answer for that.';
          wait.textContent = reply;
          wait.classList.remove('is-pending');
          context = { params: d.params || {}, awaiting: d.awaiting || null, has_result: !!d.has_result };
          history.push({ role: 'user', content: q }, { role: 'assistant', content: reply });
        })
        .catch(function (err) {
          wait.textContent = 'Sorry, I could not answer right now (' + err.message + ').';
          wait.classList.remove('is-pending');
        })
        .finally(function () { pending = false; log.scrollTop = log.scrollHeight; });
    }
    log.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fomi-ask]');
      if (b) ask(b.getAttribute('data-fomi-ask'));
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      ask(input.value);
      input.value = '';
    });
  }

  window.OmiV2 = {
    esc: esc,
    getJSON: getJSON,
    places: Places,
    setMood: setMood,
    loadAlerts: loadAlerts,
    alertItem: alertItem,
    applyMode: applyMode,
    mode: function () { return document.body.getAttribute('data-mode') || 'learn'; },
    imgBase: '/static/img/weather/'
  };

  document.addEventListener('DOMContentLoaded', function () {
    initModeSwitch();
    initFloatingOmi();
    if (document.querySelector('.workspace-shell')) {
      loadAlerts().then(renderBadges).catch(function () {
        var list = document.querySelector('[data-notif-list]');
        if (list) list.innerHTML = '<p>Live alerts are unavailable right now.</p>';
      });
      document.addEventListener('omi:places', function () { loadAlerts(true).then(renderBadges).catch(function () {}); });
    }
  });
})();
