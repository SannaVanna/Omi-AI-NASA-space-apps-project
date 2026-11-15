/* Omi AI — small dependency-free SVG charts (line + trend + CI band, bars). */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function niceTicks(min, max, count) {
    var span = max - min || 1;
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = (span / count) / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var ticks = [];
    for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(6));
    return ticks;
  }

  /**
   * line(container, {series:[{points:[{x,y}], color, width, dash, dots, label}],
   *   band:{lo:[{x,y}], hi:[{x,y}], color}, area:bool, height, yUnit, xTicks, yTicks, minimal})
   */
  function line(container, opts) {
    container.innerHTML = '';
    var w = Math.max(container.clientWidth || 600, 240);
    var h = opts.height || 240;
    var m = opts.minimal ? { t: 8, r: 8, b: 8, l: 8 } : { t: 12, r: 14, b: 26, l: 44 };
    var all = [];
    opts.series.forEach(function (s) { all = all.concat(s.points); });
    if (opts.band) all = all.concat(opts.band.lo, opts.band.hi);
    var xs = all.map(function (p) { return p.x; }), ys = all.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var pad = (y1 - y0) * 0.08 || 1; y0 -= pad; y1 += pad;
    var sx = function (x) { return m.l + (x - x0) / ((x1 - x0) || 1) * (w - m.l - m.r); };
    var sy = function (y) { return m.t + (1 - (y - y0) / ((y1 - y0) || 1)) * (h - m.t - m.b); };
    var svg = el('svg', { viewBox: '0 0 ' + w + ' ' + h, width: '100%', height: h, role: 'img', 'aria-label': opts.label || 'Chart', class: 'omi-chart' }, container);

    if (!opts.minimal) {
      niceTicks(y0, y1, opts.yTicks || 4).forEach(function (t) {
        el('line', { x1: m.l, x2: w - m.r, y1: sy(t), y2: sy(t), class: 'oc-grid' }, svg);
        var tx = el('text', { x: m.l - 8, y: sy(t) + 4, 'text-anchor': 'end', class: 'oc-tick' }, svg);
        tx.textContent = Math.abs(t) >= 100 ? Math.round(t) : (+t.toFixed(1));
      });
      niceTicks(x0, x1, opts.xTicks || 5).forEach(function (t) {
        if (t < x0 || t > x1) return;
        var tx = el('text', { x: sx(t), y: h - 6, 'text-anchor': 'middle', class: 'oc-tick' }, svg);
        tx.textContent = Math.round(t);
      });
    }
    function path(points) { return points.map(function (p, i) { return (i ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1); }).join(' '); }
    if (opts.band) {
      var d = path(opts.band.hi) + ' ' + opts.band.lo.slice().reverse().map(function (p) { return 'L' + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1); }).join(' ') + ' Z';
      el('path', { d: d, fill: opts.band.color || '#2563EB', 'fill-opacity': 0.13 }, svg);
    }
    opts.series.forEach(function (s, idx) {
      if (opts.area && idx === 0) {
        var pts = s.points;
        el('path', { d: path(pts) + ' L' + sx(pts[pts.length - 1].x) + ' ' + (h - m.b) + ' L' + sx(pts[0].x) + ' ' + (h - m.b) + ' Z', fill: s.color, 'fill-opacity': 0.1 }, svg);
      }
      el('path', { d: path(s.points), fill: 'none', stroke: s.color, 'stroke-width': s.width || 2, 'stroke-dasharray': s.dash ? '7 6' : undefined, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
      if (s.dots) s.points.forEach(function (p) {
        var c = el('circle', { cx: sx(p.x), cy: sy(p.y), r: 3, fill: s.color, class: 'oc-dot' }, svg);
        var t = el('title', {}, c); t.textContent = Math.round(p.x) + ': ' + (+p.y.toFixed(2)) + (opts.yUnit ? ' ' + opts.yUnit : '');
      });
    });
    return svg;
  }

  /** bars(container, {labels:[], groups:[{values:[], color, label}], height, unit}) */
  function bars(container, opts) {
    container.innerHTML = '';
    var w = Math.max(container.clientWidth || 600, 240), h = opts.height || 200;
    var m = { t: 10, r: 8, b: 24, l: 40 };
    var max = 0; opts.groups.forEach(function (g) { g.values.forEach(function (v) { max = Math.max(max, v); }); });
    var ticks = niceTicks(0, max * 1.05, 4); var top = ticks[ticks.length - 1] || max;
    var svg = el('svg', { viewBox: '0 0 ' + w + ' ' + h, width: '100%', height: h, role: 'img', 'aria-label': opts.label || 'Bar chart', class: 'omi-chart' }, container);
    var sy = function (v) { return m.t + (1 - v / top) * (h - m.t - m.b); };
    ticks.forEach(function (t) {
      el('line', { x1: m.l, x2: w - m.r, y1: sy(t), y2: sy(t), class: 'oc-grid' }, svg);
      var tx = el('text', { x: m.l - 8, y: sy(t) + 4, 'text-anchor': 'end', class: 'oc-tick' }, svg); tx.textContent = t;
    });
    var n = opts.labels.length, slot = (w - m.l - m.r) / n, g = opts.groups.length, bw = Math.min(22, slot * 0.7 / g);
    opts.labels.forEach(function (lab, i) {
      var cx = m.l + slot * i + slot / 2;
      opts.groups.forEach(function (grp, j) {
        var v = grp.values[i], x = cx - (g * bw) / 2 + j * bw + 1;
        var r = el('rect', { x: x, y: sy(v), width: bw - 2, height: sy(0) - sy(v), rx: 4, fill: grp.color }, svg);
        var t = el('title', {}, r); t.textContent = grp.label + ' · ' + lab + ': ' + Math.round(v) + (opts.unit ? ' ' + opts.unit : '');
      });
      var tx = el('text', { x: cx, y: h - 6, 'text-anchor': 'middle', class: 'oc-tick' }, svg); tx.textContent = lab;
    });
    return svg;
  }

  window.OmiCharts = { line: line, bars: bars };
})();
