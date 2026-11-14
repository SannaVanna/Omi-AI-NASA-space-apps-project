/* ==========================================================================
   Omi AI — Shared UI Utilities, Theme Manager, Navigation & Profile/Settings
   Pure Vanilla JavaScript
   ========================================================================== */

(function () {
  'use strict';

  var THEME_STORAGE_KEY = 'omi_theme';
  var PREFS_STORAGE_KEY = 'omi_workspace_prefs';

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /** The stored choice: 'light', 'dark' or 'system' (follow the device). */
  function getThemePreference() {
    try {
      var saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
    } catch (e) {}
    return 'system';
  }

  function resolveTheme(pref) {
    if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
    return pref === 'dark' ? 'dark' : 'light';
  }

  /** The theme currently shown ('light' or 'dark'). */
  function getSavedTheme() {
    return resolveTheme(getThemePreference());
  }

  function applyTheme(theme) {
    var pref = (theme === 'dark' || theme === 'system') ? theme : 'light';
    var normalized = resolveTheme(pref);
    document.documentElement.setAttribute('data-theme', normalized);
    if (normalized === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch (e) {}

    var sunIcons = document.querySelectorAll('.theme-icon-sun');
    var moonIcons = document.querySelectorAll('.theme-icon-moon');
    sunIcons.forEach(function (el) {
      el.classList.toggle('is-hidden', normalized === 'dark');
    });
    moonIcons.forEach(function (el) {
      el.classList.toggle('is-hidden', normalized !== 'dark');
    });

    document.querySelectorAll('[data-set-theme]').forEach(function (btn) {
      var isMatch = btn.getAttribute('data-set-theme') === pref;
      btn.classList.toggle('is-active', isMatch);
      btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
    });

    document.dispatchEvent(new CustomEvent('omi:themechange', { detail: { theme: normalized } }));
  }

  function initThemeControls() {
    applyTheme(getThemePreference());

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () { if (getThemePreference() === 'system') applyTheme('system'); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }

    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = getSavedTheme() === 'dark' ? 'light' : 'dark';
        applyTheme(next);
      });
    });

    document.querySelectorAll('[data-set-theme]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var chosen = btn.getAttribute('data-set-theme');
        applyTheme(chosen);
      });
    });
  }

  function initNavigationDrawers() {
    // Workspace sidebar mobile drawer
    var sidebar = document.getElementById('workspace-sidebar');
    var sidebarToggle = document.getElementById('sidebar-toggle');
    var backdrop = document.getElementById('sidebar-backdrop');

    function setSidebarOpen(open) {
      if (!sidebar || !sidebarToggle) return;
      sidebar.classList.toggle('is-open', open);
      if (backdrop) backdrop.classList.toggle('is-visible', open);
      sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    if (sidebarToggle && sidebar) {
      sidebarToggle.addEventListener('click', function () {
        setSidebarOpen(!sidebar.classList.contains('is-open'));
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', function () {
        setSidebarOpen(false);
      });
    }

    // Landing page mobile menu
    var landingMenuToggle = document.getElementById('landing-menu-toggle');
    var landingDrawer = document.getElementById('landing-mobile-drawer');

    if (landingMenuToggle && landingDrawer) {
      landingMenuToggle.addEventListener('click', function () {
        var isOpen = landingDrawer.classList.toggle('is-open');
        landingMenuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });

      landingDrawer.querySelectorAll('a').forEach(function (link) {
        link.addEventListener('click', function () {
          landingDrawer.classList.remove('is-open');
          landingMenuToggle.setAttribute('aria-expanded', 'false');
        });
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        if (landingDrawer) landingDrawer.classList.remove('is-open');
      }
    });
  }

  function getPreferences() {
    var defaults = {
      temp_unit: '°C',
      rain_unit: 'mm',
      default_region: 'lagos',
      alpha: '0.05'
    };
    try {
      var raw = localStorage.getItem(PREFS_STORAGE_KEY);
      if (!raw) return defaults;
      var parsed = JSON.parse(raw);
      return Object.assign({}, defaults, parsed);
    } catch (e) {
      return defaults;
    }
  }

  function savePreferences(prefs) {
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch (e) {}
  }

  function initSettingsPage() {
    var root = document.getElementById('settings-root');
    var form = document.getElementById('settings-form');
    if (!root || !form) return;

    var banner = document.getElementById('settings-feedback-banner');
    var prefs = getPreferences();

    var tempSelect = document.getElementById('pref-temp-unit');
    var rainSelect = document.getElementById('pref-rain-unit');
    var regionSelect = document.getElementById('pref-default-region');
    var alphaSelect = document.getElementById('pref-alpha');

    if (tempSelect) tempSelect.value = prefs.temp_unit;
    if (rainSelect) rainSelect.value = prefs.rain_unit;
    if (regionSelect) regionSelect.value = prefs.default_region;
    if (alphaSelect) alphaSelect.value = prefs.alpha;

    function showNotice(type, text) {
      if (!banner) return;
      banner.className = 'notice notice-' + type;
      banner.textContent = text;
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var updated = {
        temp_unit: tempSelect ? tempSelect.value : '°C',
        rain_unit: rainSelect ? rainSelect.value : 'mm',
        default_region: regionSelect ? regionSelect.value : 'lagos',
        alpha: alphaSelect ? alphaSelect.value : '0.05'
      };
      savePreferences(updated);

      var endpoint = root.getAttribute('data-settings-endpoint') || '/api/settings';
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ theme: getThemePreference() }, updated))
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          showNotice('success', 'Preferences saved. Charts and results will use your chosen units and significance level.');
        })
        .catch(function () {
          showNotice('info', 'Preferences saved in this browser.');
        });
    });

    var resetBtn = document.getElementById('reset-prefs-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        try {
          localStorage.removeItem(PREFS_STORAGE_KEY);
          localStorage.removeItem(THEME_STORAGE_KEY);
        } catch (e) {}
        applyTheme('light');
        var fresh = getPreferences();
        if (tempSelect) tempSelect.value = fresh.temp_unit;
        if (rainSelect) rainSelect.value = fresh.rain_unit;
        if (regionSelect) regionSelect.value = fresh.default_region;
        if (alphaSelect) alphaSelect.value = fresh.alpha;
        showNotice('info', 'Local appearance and workspace preferences have been reset to defaults.');
      });
    }
  }

  function initProfilePage() {
    var root = document.getElementById('profile-root');
    var form = document.getElementById('profile-form');
    if (!root || !form) return;

    var nameInput = document.getElementById('profile-name-input');
    var emailInput = document.getElementById('profile-email-input');
    var displayName = document.getElementById('profile-display-name');
    var displayEmail = document.getElementById('profile-display-email');
    var avatarCircle = document.getElementById('profile-avatar-circle');
    var banner = document.getElementById('profile-feedback-banner');

    function computeInitials(name) {
      var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return 'DR';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    if (nameInput) {
      nameInput.addEventListener('input', function () {
        var val = nameInput.value.trim() || 'Dr. Researcher';
        if (displayName) displayName.textContent = val;
        if (avatarCircle) avatarCircle.textContent = computeInitials(val);
      });
    }

    if (emailInput) {
      emailInput.addEventListener('input', function () {
        if (displayEmail) displayEmail.textContent = emailInput.value.trim() || 'researcher@omi-ai.org';
      });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var formData = new FormData(form);
      var payload = {
        name: formData.get('name'),
        email: formData.get('email'),
        affiliation: formData.get('affiliation'),
        role: formData.get('role'),
        interests: formData.getAll('interests'),
        study_regions: formData.getAll('study_regions')
      };

      var endpoint = root.getAttribute('data-profile-endpoint') || '/api/profile';
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          if (banner) {
            banner.className = 'notice notice-success';
            banner.textContent = 'Profile saved.';
          }
        })
        .catch(function () {
          if (banner) {
            banner.className = 'notice notice-warning';
            banner.textContent = 'Could not save your profile. Please check the details and try again.';
          }
        });
    });
  }

  /**
   * SVG time-series chart drawn strictly from points returned by the backend.
   * config.series: Array<{ name, color, dashed, points: Array<{label, value}> }>
   * Series are aligned on their labels (e.g. years), so several regions and a
   * trend line can share one chart.
   */
  function renderChart(container, config) {
    if (!container) return;
    var cfg = config || {};
    var unit = cfg.unit || '';
    var series = (cfg.series || []).map(function (s) {
      return {
        name: s.name || '',
        color: s.color || '#168C83',
        dashed: !!s.dashed,
        showPoints: s.showPoints !== false,
        points: (s.points || []).filter(function (pt) {
          return pt && pt.value !== null && pt.value !== undefined && !Number.isNaN(Number(pt.value));
        }).map(function (pt) { return { label: String(pt.label), value: Number(pt.value) }; })
      };
    }).filter(function (s) { return s.points.length > 0; });

    if (series.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No numeric time-series points were returned for plotting.</p></div>';
      return;
    }

    var labelSet = {};
    series.forEach(function (s) { s.points.forEach(function (p) { labelSet[p.label] = true; }); });
    (cfg.extraLabels || []).forEach(function (l) { labelSet[String(l)] = true; });
    var labels = Object.keys(labelSet).sort();
    var index = {};
    labels.forEach(function (l, i) { index[l] = i; });

    var width = 760;
    var height = 280;
    var pad = { top: 20, right: 20, bottom: 40, left: 64 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;

    var all = [];
    series.forEach(function (s) { s.points.forEach(function (p) { all.push(p.value); }); });
    var minVal = Math.min.apply(null, all);
    var maxVal = Math.max.apply(null, all);
    if (minVal === maxVal) { minVal -= 1; maxVal += 1; }
    var yMargin = (maxVal - minVal) * 0.1;
    var yMin = minVal - yMargin;
    var yMax = maxVal + yMargin;
    // Quantities that cannot be negative (e.g. rainfall) keep a zero floor.
    if (minVal >= 0 && yMin < 0) yMin = 0;
    var decimals = (yMax - yMin) < 10 ? 1 : 0;

    function xFor(label) {
      if (labels.length === 1) return pad.left + plotW / 2;
      return pad.left + (index[label] / (labels.length - 1)) * plotW;
    }
    function yFor(v) {
      return pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    }

    var parts = [];
    for (var g = 0; g <= 4; g++) {
      var frac = g / 4;
      var gy = pad.top + frac * plotH;
      var gVal = yMax - frac * (yMax - yMin);
      parts.push(
        '<line x1="' + pad.left + '" y1="' + gy.toFixed(1) + '" x2="' + (width - pad.right) + '" y2="' + gy.toFixed(1) + '" stroke="var(--border-subtle)" stroke-width="1"/>' +
        '<text x="' + (pad.left - 10) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" fill="var(--text-muted)" font-family="JetBrains Mono, monospace" font-size="11">' + gVal.toFixed(decimals) + '</text>'
      );
    }

    var tickCount = Math.min(6, labels.length);
    for (var t = 0; t < tickCount; t++) {
      var li = tickCount === 1 ? 0 : Math.round(t * (labels.length - 1) / (tickCount - 1));
      var lx = xFor(labels[li]);
      var anchor = t === 0 ? 'start' : (t === tickCount - 1 ? 'end' : 'middle');
      parts.push('<text x="' + lx.toFixed(1) + '" y="' + (height - 12) + '" text-anchor="' + anchor + '" fill="var(--text-muted)" font-family="JetBrains Mono, monospace" font-size="11">' + escapeHtml(labels[li]) + '</text>');
    }
    if (unit) {
      parts.push('<text x="14" y="' + (pad.top + plotH / 2) + '" transform="rotate(-90 14 ' + (pad.top + plotH / 2) + ')" text-anchor="middle" fill="var(--text-muted)" font-family="JetBrains Mono, monospace" font-size="11">' + escapeHtml(unit) + '</text>');
    }

    // Optional shaded region (e.g. hidden observations in the challenge).
    if (cfg.shadeFrom && index[cfg.shadeFrom] !== undefined) {
      var sx = xFor(cfg.shadeFrom);
      parts.push('<rect x="' + sx.toFixed(1) + '" y="' + pad.top + '" width="' + Math.max(0, width - pad.right - sx).toFixed(1) + '" height="' + plotH + '" fill="var(--bg-accent-tint)" opacity="0.85"/>');
      parts.push('<line x1="' + sx.toFixed(1) + '" y1="' + pad.top + '" x2="' + sx.toFixed(1) + '" y2="' + (pad.top + plotH) + '" stroke="var(--text-muted)" stroke-dasharray="4 4"/>');
      if (cfg.shadeLabel) {
        parts.push('<text x="' + ((sx + width - pad.right) / 2).toFixed(1) + '" y="' + (pad.top + plotH / 2) + '" text-anchor="middle" fill="var(--text-muted)" font-family="Manrope, sans-serif" font-weight="700" font-size="14">' + escapeHtml(cfg.shadeLabel) + '</text>');
      }
    }

    series.forEach(function (s, si) {
      var d = s.points.map(function (p, i) {
        return (i === 0 ? 'M' : 'L') + xFor(p.label).toFixed(2) + ' ' + yFor(p.value).toFixed(2);
      }).join(' ');
      parts.push('<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.dashed ? 2 : 2.5) + '"' + (s.dashed ? ' stroke-dasharray="6 5"' : '') + ' stroke-linecap="round" stroke-linejoin="round"/>');
      if (s.showPoints) {
        var r = s.points.length > 60 ? 2 : 3.5;
        s.points.forEach(function (p, pi) {
          parts.push('<circle class="chart-point" data-s="' + si + '" data-p="' + pi + '" cx="' + xFor(p.label).toFixed(2) + '" cy="' + yFor(p.value).toFixed(2) + '" r="' + r + '" fill="' + s.color + '" stroke="var(--bg-surface)" stroke-width="1.2"/>');
        });
      }
    });

    var legend = '';
    if (series.length > 1 || cfg.legend) {
      legend = '<div class="chart-legend">' + series.map(function (s) {
        return '<span class="chart-legend-item"><span class="chart-legend-swatch' + (s.dashed ? ' is-dashed' : '') + '" style="--swatch:' + s.color + '"></span>' + escapeHtml(s.name) + '</span>';
      }).join('') + '</div>';
    }

    container.innerHTML =
      legend +
      '<div style="position:relative;">' +
        '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" style="overflow:visible;" role="img" aria-label="' + escapeHtml(cfg.ariaLabel || 'Time-series chart') + '">' +
          parts.join('') +
        '</svg>' +
        '<div class="chart-tooltip is-hidden"></div>' +
      '</div>';

    var tooltip = container.querySelector('.chart-tooltip');
    if (!tooltip) return;
    container.querySelectorAll('.chart-point').forEach(function (dot) {
      dot.addEventListener('mouseenter', function () {
        var s = series[Number(dot.getAttribute('data-s'))];
        var pt = s && s.points[Number(dot.getAttribute('data-p'))];
        if (!pt) return;
        tooltip.textContent = (s.name ? s.name + ' · ' : '') + pt.label + ' · ' + formatNumber(pt.value, 2) + (unit ? ' ' + unit : '');
        tooltip.classList.remove('is-hidden');
        var rect = container.getBoundingClientRect();
        var dotRect = dot.getBoundingClientRect();
        tooltip.style.left = Math.max(8, Math.min(rect.width - 200, dotRect.left - rect.left - 40)) + 'px';
        tooltip.style.top = Math.max(4, dotRect.top - rect.top - 36) + 'px';
      });
      dot.addEventListener('mouseleave', function () {
        tooltip.classList.add('is-hidden');
      });
    });
  }

  /** Backwards-compatible single-series helper. */
  function renderLineChartSvg(container, points, options) {
    var opts = options || {};
    renderChart(container, {
      unit: opts.unit,
      series: [{ name: opts.name || '', color: opts.color || '#168C83', points: points }]
    });
  }

  function formatNumber(value, digits, signed) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    var n = Number(value);
    var text = n.toFixed(digits === undefined ? 2 : digits);
    if (signed && n > 0) text = '+' + text;
    return text.replace('-', '−');
  }

  function formatP(p) {
    if (p === null || p === undefined) return '—';
    return p < 0.001 ? '< 0.001' : Number(p).toFixed(3);
  }

  /**
   * Apply the user's display-unit preference (Settings page).
   * Levels (e.g. mean temperature) and rates (per decade) convert differently.
   */
  function unitsFor(variableId) {
    var prefs = getPreferences();
    if (variableId === 'temperature' && prefs.temp_unit === 'K') {
      return { level: 'K', rate: 'K per decade', toLevel: function (v) { return v === null ? null : v + 273.15; }, toRate: function (v) { return v; } };
    }
    if (variableId === 'rainfall' && prefs.rain_unit === 'mm/day') {
      return { level: 'mm/day', rate: 'mm/day per decade', toLevel: function (v) { return v === null ? null : v / 365.25; }, toRate: function (v) { return v === null ? null : v / 365.25; } };
    }
    if (variableId === 'rainfall') {
      return { level: 'mm/year', rate: 'mm/year per decade', toLevel: function (v) { return v; }, toRate: function (v) { return v; } };
    }
    return { level: '°C', rate: '°C per decade', toLevel: function (v) { return v; }, toRate: function (v) { return v; } };
  }

  window.OmiUI = {
    escapeHtml: escapeHtml,
    applyTheme: applyTheme,
    getSavedTheme: getSavedTheme,
    getThemePreference: getThemePreference,
    getPreferences: getPreferences,
    renderLineChartSvg: renderLineChartSvg,
    renderChart: renderChart,
    formatNumber: formatNumber,
    formatP: formatP,
    unitsFor: unitsFor
  };

  function initNotifications() {
    var btn = document.getElementById('notif-btn');
    var panel = document.getElementById('notif-panel');
    if (!btn || !panel) return;
    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = panel.classList.toggle('is-hidden') === false;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (event) {
      if (!panel.contains(event.target)) {
        panel.classList.add('is-hidden');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initThemeControls();
    initNotifications();
    initNavigationDrawers();
    initSettingsPage();
    initProfilePage();
  });
})();
