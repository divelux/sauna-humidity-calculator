/*!
 * Löyly Calculator — interface
 * (c) 2026 DIVELUX Inc. MIT License. https://diveluxsaunahat.com
 */
(function () {
  'use strict';
  var H = window.SaunaHumidity;
  var form = document.getElementById('shu-form');
  if (!H || !form) return;

  function $(name) { return document.querySelector('[data-o="' + name + '"]'); }
  function inp(name) { return form.querySelector('[data-i="' + name + '"]'); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function fmt(n, digits, loose) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: loose ? 0 : digits || 0, maximumFractionDigits: digits || 0 });
  }
  function trim(n, digits) { return String(H.round(n, digits)); }

  /* State is kept in °C and m³; the fields show it in the chosen unit. */
  var state = {};
  var d = H.DEFAULTS, q = H.fromQuery(location.search);
  ['unit', 'tempC', 'rh', 'volume', 'raise'].forEach(function (k) {
    state[k] = Object.prototype.hasOwnProperty.call(q, k) ? q[k] : d[k];
  });

  /* ---------- fields <-> state ---------- */
  function fill() {
    var us = state.unit === 'us';
    inp('temp').value = isFinite(state.tempC) ? trim(us ? H.c2f(state.tempC) : state.tempC, us ? 0 : 1) : '';
    inp('rh').value = isFinite(state.rh) ? trim(state.rh, 1) : '';
    inp('volume').value = isFinite(state.volume) ? trim(us ? H.m3ToCuft(state.volume) : state.volume, us ? 0 : 2) : '';
    inp('raise').value = isFinite(state.raise) ? trim(state.raise, 1) : '';
    $('tunit').textContent = us ? '°F' : '°C';
    $('vunit').textContent = us ? 'cu ft' : 'm³';
    $('volhint').textContent = us ?
      'Length times width times ceiling height. A room 6 ft by 5 ft with a 7 ft ceiling is 210 cu ft.' :
      'Length times width times ceiling height. A room 2 m by 1.5 m with a 2.1 m ceiling is 6.3 m³.';
    form.querySelectorAll('input[name="unit"]').forEach(function (r) { r.checked = r.value === state.unit; });
  }

  function read() {
    var us = state.unit === 'us';
    var t = H.num(inp('temp').value);
    state.tempC = us ? H.f2c(t) : t;
    state.rh = H.num(inp('rh').value);
    var v = H.num(inp('volume').value);
    state.volume = us ? H.cuftToM3(v) : v;
    state.raise = inp('raise').value === '' ? 0 : H.num(inp('raise').value);
  }

  /* ---------- output ---------- */
  var liveTimer = null;
  function say(text) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { $('live').textContent = text; }, 700);
  }

  function showErrors(errors) {
    [['temp', 'temp'], ['rh', 'rh'], ['volume', 'volume'], ['raise', 'raise']].forEach(function (p) {
      var el = document.getElementById('shu-e-' + p[0]);
      var msg = errors && errors[p[0]];
      el.hidden = !msg;
      el.textContent = msg || '';
      inp(p[1]).setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
  }

  function render() {
    var r = H.calc(state);
    var boxes = ['stats', 'babox', 'pourbox'];
    if (!r.ok) {
      showErrors(r.errors);
      $('kicker').textContent = 'Water to raise the humidity';
      $('headline').textContent = 'Check the numbers';
      $('sub').textContent = 'One of the numbers is missing or outside what this tool covers. Fix the marked field and the result comes back.';
      boxes.forEach(function (b) { $(b).hidden = true; });
      say('Check the numbers. ' + Object.keys(r.errors).map(function (k) { return r.errors[k]; }).join(' '));
      return;
    }
    showErrors(null);
    var us = state.unit === 'us';
    var temp = function (c, f) { return us ? fmt(f, 0) + ' °F' : fmt(c, 1, true) + ' °C'; };
    var room = us ? fmt(r.volumeCuFt, 0) + ' cu ft' : fmt(r.input.volume, 2, true) + ' m³';
    var here = temp(r.input.tempC, r.tempF);
    var dew = function (s) { return s.dewPointC == null ? (us ? 'below 32 °F' : 'below 0 °C') : temp(s.dewPointC, s.dewPointF); };
    var water = us ? fmt(r.water.flOz, 1) + ' fl oz' : fmt(r.water.ml, 0) + ' ml';
    var waterBoth = us ? fmt(r.water.flOz, 1) + ' fl oz (' + fmt(r.water.ml, 0) + ' ml)' : fmt(r.water.ml, 0) + ' ml (' + fmt(r.water.flOz, 1) + ' fl oz)';
    var raising = r.input.raise > 0;

    if (raising) {
      $('kicker').textContent = 'Water to go from ' + fmt(r.now.rh, 1, true) + '% to ' + fmt(r.after.rh, 1, true) + '% humidity';
      $('headline').textContent = water;
      $('sub').textContent = 'About ' + waterBoth + ' of water has to turn to steam and stay in the air to take this ' + room +
        ' room from ' + fmt(r.now.rh, 1, true) + '% to ' + fmt(r.after.rh, 1, true) + '% relative humidity at ' + here +
        '. A real sauna needs more, because steam escapes and wood soaks it up.';
    } else {
      $('kicker').textContent = 'Dew point of this air';
      $('headline').textContent = dew(r.now);
      $('sub').textContent = 'At ' + here + ' and ' + fmt(r.now.rh, 1, true) + '% relative humidity, each cubic meter of air holds ' +
        fmt(r.now.absGm3, 1) + ' grams of water vapor. Anything cooler than the dew point collects condensation.';
    }

    var stats = [
      ['Dew point', dew(r.now), r.now.dewPointC == null ? 'too dry for the steam-table equation' : us ? fmt(r.now.dewPointC, 1, true) + ' °C' : fmt(r.now.dewPointF, 0) + ' °F'],
      ['Absolute humidity', fmt(r.now.absGm3, 1) + ' g/m³', 'water vapor in each cubic meter'],
      ['Vapor share of the air', fmt(r.now.vaporSharePct, 1) + '%', 'by volume; ' + fmt(r.now.vaporKPa, 2) + ' kPa'],
      ['Most this air can hold', fmt(r.maxRH, 1, true) + '% RH', r.capped ? 'capped by air pressure above 212 °F (100 °C)' : 'saturation at ' + fmt(r.satKPa, 2) + ' kPa']
    ];
    $('stats').innerHTML = stats.map(function (s) {
      return '<div class="dvx-stat"><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '<small>' + esc(s[2]) + '</small></dd></div>';
    }).join('');
    $('stats').hidden = false;

    if (raising) {
      var rows = [
        ['Relative humidity', fmt(r.now.rh, 1, true) + '%', fmt(r.after.rh, 1, true) + '%'],
        ['Dew point', dew(r.now), dew(r.after)],
        ['Absolute humidity', fmt(r.now.absGm3, 1) + ' g/m³', fmt(r.after.absGm3, 1) + ' g/m³'],
        ['Vapor share of the air', fmt(r.now.vaporSharePct, 1) + '%', fmt(r.after.vaporSharePct, 1) + '%'],
        ['Water vapor in the room', fmt(r.now.absGm3 * r.input.volume, 0) + ' g', fmt(r.after.absGm3 * r.input.volume, 0) + ' g']
      ];
      $('ba').innerHTML = rows.map(function (row) {
        return '<tr><th scope="row">' + esc(row[0]) + '</th><td>' + esc(row[1]) + '</td><td>' + esc(row[2]) + '</td></tr>';
      }).join('');
    }
    $('babox').hidden = !raising;

    var pour = us ? '0.2 liter (' + fmt(r.ladle.flOz, 1) + ' fl oz)' : '0.2 liter (200 ml)';
    $('pour').innerHTML = r.ladle.overflows ?
      'Harvia\'s heater manuals say to throw no more than <strong>' + esc(pour) + '</strong> of water at a time. In this room that is more than the air can take up: the humidity would reach its ceiling of ' +
        esc(fmt(r.maxRH, 1, true)) + '% after <strong>' + esc(fmt(r.ladle.points, 1)) + ' points</strong>, and the rest would condense.' :
      'Harvia\'s heater manuals say to throw no more than <strong>' + esc(pour) + '</strong> of water at a time. If every drop of that turned to steam and stayed in the air, it would lift this room by <strong>' +
        esc(fmt(r.ladle.points, 1)) + ' points</strong> of relative humidity. Each point takes ' +
        esc(us ? fmt(r.water.flOzPerPoint, 2) + ' fl oz (' + fmt(r.water.gramsPerPoint, 1) + ' ml)' : fmt(r.water.gramsPerPoint, 1) + ' ml') + ' here.';
    $('pourbox').hidden = false;

    say(raising ?
      'About ' + waterBoth + ' of water to go from ' + fmt(r.now.rh, 1, true) + ' to ' + fmt(r.after.rh, 1, true) + ' percent humidity. Dew point now ' + dew(r.now) + '.' :
      'Dew point ' + dew(r.now) + '. Absolute humidity ' + fmt(r.now.absGm3, 1) + ' grams per cubic meter.');

    try { history.replaceState(null, '', location.pathname + '?' + H.toQuery(state)); } catch (e) { /* file:// or sandboxed frame */ }
  }

  /* ---------- events ---------- */
  form.addEventListener('input', function (e) {
    if (e.target.name === 'unit') {
      // Keep the air and the room, change how they are written. Re-read first so nothing typed is lost.
      var next = e.target.value;
      read();
      state.unit = next;
      fill();
    } else {
      read();
    }
    render();
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  document.querySelector('[data-a="share"]').addEventListener('click', function () {
    var url = location.origin + location.pathname + '?' + H.toQuery(state);
    var status = $('sharestatus');
    var manual = function () { status.textContent = 'Copy the address from the address bar.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { status.textContent = 'Link copied.'; }, manual);
    } else manual();
  });

  fill();
  render();
})();
