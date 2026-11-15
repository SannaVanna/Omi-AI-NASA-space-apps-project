/* Omi AI — sign up (2 steps: details, role + insight mode) and log in. */
(function () {
  'use strict';

  var MODE_TEXT = {
    simple: 'Simple mode: big visuals, plain words and one clear takeaway, plus safety tips.',
    learn: 'Learn mode: charts with trend lines, short explanations and a glossary of terms.',
    research: "Research mode: Sen's slope with 95% CI, modified Mann-Kendall Z, τ and p-values, method notes and CSV export."
  };

  function saveProfile(profile) {
    return fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(profile)
    }).then(function (res) {
      return res.json().then(function (d) { if (!res.ok) throw new Error(d.error || 'HTTP ' + res.status); return d.profile; });
    }).then(function (saved) {
      try { localStorage.setItem('omi_profile', JSON.stringify(saved)); } catch (e) {}
      return saved;
    });
  }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function next() {
    var q = new URLSearchParams(location.search).get('next');
    return q && q.charAt(0) === '/' && q.charAt(1) !== '/' ? q : '/dashboard';
  }

  // ------------------------------------------------------------- sign up
  var form = document.getElementById('signup-form');
  if (form) {
    var steps = form.querySelectorAll('[data-step]');
    var show = function (n) { steps.forEach(function (s) { s.hidden = s.getAttribute('data-step') !== String(n); }); var f = form.querySelector('[data-step="' + n + '"] input, [data-step="' + n + '"] button'); if (f) f.focus(); };
    var err = function (n, msg) { var e = form.querySelector('[data-step="' + n + '"] [data-error]'); if (e) e.textContent = msg || ''; };

    form.querySelector('[data-next]').addEventListener('click', function () {
      var name = form.querySelector('#su-name').value.trim(), email = form.querySelector('#su-email').value.trim();
      if (name.length < 2) return err(1, 'Please enter your name.');
      if (!validEmail(email)) return err(1, 'Please enter a valid email address.');
      err(1, ''); show(2);
    });
    form.querySelector('[data-prev]').addEventListener('click', function () { show(1); });

    var modeText = form.querySelector('[data-mode-text]');
    function syncMode(fromRole) {
      var role = form.querySelector('input[name="role"]:checked');
      var rec = role ? role.getAttribute('data-default-mode') : 'learn';
      form.querySelectorAll('[data-recommended]').forEach(function (n) { n.hidden = n.getAttribute('data-recommended') !== rec; });
      if (fromRole) { var r = form.querySelector('input[name="mode"][value="' + rec + '"]'); if (r) r.checked = true; }
      var m = form.querySelector('input[name="mode"]:checked');
      if (modeText && m) modeText.textContent = MODE_TEXT[m.value];
    }
    form.querySelectorAll('input[name="role"]').forEach(function (r) { r.addEventListener('change', function () { syncMode(true); }); });
    form.querySelectorAll('input[name="mode"]').forEach(function (r) { r.addEventListener('change', function () { syncMode(false); }); });
    syncMode(true);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('[data-step="2"] button[type="submit"]');
      btn.disabled = true;
      saveProfile({
        name: form.querySelector('#su-name').value.trim(),
        email: form.querySelector('#su-email').value.trim(),
        affiliation: form.querySelector('#su-aff').value.trim(),
        role: (form.querySelector('input[name="role"]:checked') || {}).value,
        mode: (form.querySelector('input[name="mode"]:checked') || {}).value
      }).then(function () { location.href = next(); })
        .catch(function (x) { err(2, x.message); btn.disabled = false; });
    });
  }

  // -------------------------------------------------------------- log in
  var login = document.getElementById('login-form');
  if (login) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('omi_profile')); } catch (e) {}
    var box = document.querySelector('[data-saved]');
    var lerr = login.querySelector('[data-error]');
    if (saved && saved.name && box) {
      box.hidden = false;
      box.querySelector('[data-saved-name]').textContent = saved.name;
      box.querySelector('[data-saved-meta]').textContent = (saved.email || '') + (saved.mode ? ' · ' + saved.mode + ' mode' : '');
      box.querySelector('[data-continue]').addEventListener('click', function () {
        saveProfile(saved).then(function () { location.href = next(); }).catch(function (x) { lerr.textContent = x.message; });
      });
    }
    login.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = login.querySelector('#li-name').value.trim(), email = login.querySelector('#li-email').value.trim();
      if (name.length < 2) { lerr.textContent = 'Please enter your name.'; return; }
      if (!validEmail(email)) { lerr.textContent = 'Please enter a valid email address.'; return; }
      var role = login.querySelector('#li-role').value;
      var keep = saved && saved.email === email ? saved : {};
      saveProfile({ name: name, email: email, role: role, mode: keep.mode, affiliation: keep.affiliation })
        .then(function () { location.href = next(); })
        .catch(function (x) { lerr.textContent = x.message; });
    });
  }
})();
