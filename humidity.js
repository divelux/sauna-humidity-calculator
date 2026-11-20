/*!
 * Löyly Calculator — sauna humidity logic
 * (c) 2026 DIVELUX Inc. MIT License. https://diveluxsaunahat.com
 *
 * Pure functions, no DOM. Works in the browser (window.SaunaHumidity) and in
 * Node (require('./humidity.js')).
 *
 * WHERE THE NUMBERS COME FROM
 * This is textbook psychrometry. Nothing here is measured or invented by us.
 *
 * 1. Saturation vapor pressure of water, and its inverse (the dew point), are
 *    the saturation-line equations of IAPWS-IF97, the international industrial
 *    steam-table standard: Eq. (30) and Eq. (31) with the ten coefficients of
 *    Table 34 in IAPWS R7-97(2012), "Revised Release on the IAPWS Industrial
 *    Formulation 1997 for the Thermodynamic Properties of Water and Steam".
 *    Valid from 273.15 K to 647.096 K (0 °C to the critical point). test.js
 *    checks the release's own verification values (Tables 35 and 36).
 *
 *    Why not the Magnus formula that most weather calculators use? The usual
 *    Magnus coefficients (Alduchov and Eskridge 1996: 6.1094 hPa, 17.625,
 *    243.04 °C) were fitted for -40 to +50 °C. At sauna temperatures the
 *    formula drifts: about +1.3% at 80 °C and +2.6% at 100 °C. magnus() is
 *    kept here only so the difference can be shown and tested.
 *
 * 2. Relative humidity = vapor pressure / saturation vapor pressure.
 *
 * 3. Absolute humidity (mass of water vapor in a cubic meter of air) is the
 *    ideal gas law: density = e / (Rv x T), with Rv = 461.5 J/(kg K), the gas
 *    constant of water vapor (8.314462618 J/(mol K) / 0.01801528 kg/mol).
 *    Against the NIST steam tables the ideal gas law reads about 0.9% low for
 *    saturated vapor at 80 °C and 1.6% low at 100 °C; at sauna humidities the
 *    difference is smaller still.
 *
 * 4. The ceiling. Vapor pressure cannot be higher than the pressure of the
 *    room, and a sauna is not a pressure vessel. At standard sea-level
 *    pressure (101.325 kPa) relative humidity can reach 100% only up to the
 *    boiling point, 99.97 °C. Above that the most it can be is
 *    101.325 kPa / saturation pressure: about 71% at 110 °C.
 *
 * 5. Water to raise the humidity = room volume x the rise in absolute
 *    humidity. That is the water that has to become vapor AND stay in the air.
 *    A real sauna needs more: see the caveats on the page and in the README.
 *
 * 6. The 0.2 liter reference pour is from Harvia's heater manuals: "The
 *    amount of water thrown on the stones at a time should not exceed 0.2 l".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SaunaHumidity = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var P_ATM = 101325;          // Pa, standard atmosphere
  var RV = 461.5;              // J/(kg K), gas constant of water vapor
  var KELVIN = 273.15;
  var CUFT_PER_M3 = 35.3147;
  var ML_PER_FLOZ = 29.5735;   // US fluid ounce
  var LADLE_ML = 200;          // Harvia: no more than 0.2 l at a time

  /* IAPWS-IF97, Table 34 */
  var N = [0,
    0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2,
    0.12020824702470e5, -0.32325550322333e7, 0.14915108613530e2,
    -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849,
    0.65017534844798e3];

  /* Accepted input. Outside this the tool asks you to check the number. */
  var LIMITS = {
    tempC: { min: 20, max: 120 },     // 68 to 248 °F
    rh: { min: 1, max: 100 },
    volume: { min: 1, max: 100 },     // m³: about 35 to 3,530 cu ft
    raise: { min: 0, max: 99 }
  };
  var DEFAULTS = {
    unit: 'us', tempC: 80, rh: 15,
    volume: 5.9465,                    // 210 cu ft: a 6 x 5 x 7 ft room
    raise: 10
  };

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) ? n : NaN;
  }
  function round(v, digits) {
    var p = Math.pow(10, digits || 0);
    return Math.round(v * p) / p;
  }
  function c2f(c) { return c * 9 / 5 + 32; }
  function f2c(f) { return (f - 32) * 5 / 9; }
  function m3ToCuft(v) { return v * CUFT_PER_M3; }
  function cuftToM3(v) { return v / CUFT_PER_M3; }
  function mlToFlOz(v) { return v / ML_PER_FLOZ; }

  /* Saturation vapor pressure over water, Pa. IAPWS-IF97 Eq. (30). */
  function satPressure(tC) {
    var T = tC + KELVIN;
    var th = T + N[9] / (T - N[10]);
    var A = th * th + N[1] * th + N[2];
    var B = N[3] * th * th + N[4] * th + N[5];
    var C = N[6] * th * th + N[7] * th + N[8];
    return Math.pow(2 * C / (-B + Math.sqrt(B * B - 4 * A * C)), 4) * 1e6;
  }

  /* Saturation temperature for a vapor pressure in Pa, °C. IAPWS-IF97 Eq. (31).
     This is the dew point. Valid from 611.213 Pa (0 °C) up. */
  function satTemp(pPa) {
    var beta = Math.pow(pPa / 1e6, 0.25);
    var E = beta * beta + N[3] * beta + N[6];
    var F = N[1] * beta * beta + N[4] * beta + N[7];
    var G = N[2] * beta * beta + N[5] * beta + N[8];
    var D = 2 * G / (-F - Math.sqrt(F * F - 4 * E * G));
    return (N[10] + D - Math.sqrt((N[10] + D) * (N[10] + D) - 4 * (N[9] + N[10] * D))) / 2 - KELVIN;
  }

  /* Magnus form with the Alduchov and Eskridge (1996) coefficients, Pa.
     Fitted for -40 to +50 °C. For comparison only; not used in the results. */
  function magnus(tC) { return 610.94 * Math.exp(17.625 * tC / (243.04 + tC)); }

  /* Mass of water vapor per cubic meter, in grams, from its pressure in Pa. */
  function vaporDensity(tC, ePa) { return ePa / (RV * (tC + KELVIN)) * 1000; }

  /* Highest relative humidity (%) the air can reach at this temperature when
     the room is at atmospheric pressure. */
  function maxRH(tC, pAtm) {
    return Math.min(100, (pAtm || P_ATM) / satPressure(tC) * 100);
  }

  /* One state of the air. No validation; calc() does that. */
  function state(tC, rh) {
    var es = satPressure(tC);
    var e = es * rh / 100;
    var dew = e >= 611.213 ? satTemp(e) : null; // below 0 °C the equation does not apply
    return {
      rh: rh,
      vaporPa: e,
      dewPointC: dew,
      absGm3: vaporDensity(tC, e),
      vaporSharePct: e / P_ATM * 100
    };
  }

  function tidyState(s) {
    return {
      rh: round(s.rh, 1),
      vaporKPa: round(s.vaporPa / 1000, 2),
      dewPointC: s.dewPointC == null ? null : round(s.dewPointC, 1),
      dewPointF: s.dewPointC == null ? null : round(c2f(s.dewPointC), 0),
      absGm3: round(s.absGm3, 1),
      vaporSharePct: round(s.vaporSharePct, 1)
    };
  }

  /*
   * input: { tempC, rh, volume (m³), raise (percentage points) }
   * Returns { ok: false, errors: {field: message} } or the full result.
   */
  function calc(input) {
    input = input || {};
    var errors = {};
    var t = num(input.tempC), rh = num(input.rh), vol = num(input.volume);
    var raise = input.raise === '' || input.raise == null ? 0 : num(input.raise);
    var cap = null;

    if (isNaN(t)) errors.temp = 'Enter the temperature.';
    else if (t < LIMITS.tempC.min - 1e-9 || t > LIMITS.tempC.max + 1e-9) errors.temp = 'Check the temperature: this tool covers 68 to 248 °F (20 to 120 °C).';
    else cap = maxRH(t);

    if (isNaN(rh)) errors.rh = 'Enter the relative humidity.';
    else if (rh < LIMITS.rh.min - 1e-9 || rh > LIMITS.rh.max + 1e-9) errors.rh = 'Relative humidity must be between 1 and 100%.';
    else if (cap != null && rh > cap + 1e-9) {
      errors.rh = 'At this temperature the humidity cannot be above ' + round(Math.floor(cap * 10) / 10, 1) +
        '% at sea-level pressure. Check the reading.';
    }

    if (isNaN(vol)) errors.volume = 'Enter the room volume.';
    else if (vol < LIMITS.volume.min - 1e-9 || vol > LIMITS.volume.max + 1e-9) errors.volume = 'Check the volume: this tool covers rooms from 35 to 3,530 cu ft (1 to 100 m³).';

    if (isNaN(raise) || raise < 0 || raise > LIMITS.raise.max) errors.raise = 'Enter how many points to raise the humidity by, from 0 to 99.';
    else if (!errors.temp && !errors.rh && rh + raise > cap + 1e-9) {
      var room = Math.floor((cap - rh) * 10) / 10;
      errors.raise = room < 0.1 ?
        'The air is already at the most humidity it can hold at this temperature.' :
        'From ' + round(rh, 1) + '% the humidity can rise by at most ' + round(room, 1) + ' points at this temperature.';
    }
    for (var k in errors) { if (Object.prototype.hasOwnProperty.call(errors, k)) return { ok: false, errors: errors }; }

    var es = satPressure(t);
    var now = state(t, rh);
    var after = state(t, rh + raise);
    var gPerPoint = vaporDensity(t, es / 100) * vol;       // grams of vapor per 1 point of RH in this room
    var grams = gPerPoint * raise;
    var ladlePoints = LADLE_ML / gPerPoint;                // 1 g of water is 1 ml to within 0.3%
    var headroom = cap - rh;

    return {
      ok: true,
      input: { tempC: t, rh: rh, volume: vol, raise: raise },
      tempF: round(c2f(t), 0),
      volumeCuFt: round(m3ToCuft(vol), 0),
      satKPa: round(es / 1000, 2),
      maxRH: round(Math.floor(cap * 10) / 10, 1),
      capped: cap < 100,
      now: tidyState(now),
      after: tidyState(after),
      water: {
        grams: round(grams, 0),
        ml: round(grams, 0),
        flOz: round(mlToFlOz(grams), 1),
        gramsPerPoint: round(gPerPoint, 1),
        flOzPerPoint: round(mlToFlOz(gPerPoint), 2)
      },
      ladle: {
        ml: LADLE_ML,
        flOz: round(mlToFlOz(LADLE_ML), 1),
        points: round(Math.min(ladlePoints, headroom), 1),
        // true when 0.2 l is more than the air can take up at this temperature
        overflows: ladlePoints > headroom + 1e-9
      },
      // Magnus (Alduchov and Eskridge 1996) against IF97 at this temperature, percent
      magnusErrorPct: round((magnus(t) / es - 1) * 100, 1)
    };
  }

  /* Shareable address. Temperature in °C and volume in m³ so nothing depends on the unit. */
  function toQuery(o) {
    var r = function (v, d) { return String(round(num(v) || 0, d)); };
    return 'u=' + (o.unit === 'si' ? 'si' : 'us') + '&t=' + r(o.tempC, 2) + '&rh=' + r(o.rh, 1) +
      '&v=' + r(o.volume, 4) + '&up=' + r(o.raise, 1);
  }
  function fromQuery(search) {
    var out = {};
    String(search || '').replace(/^[?#]/, '').split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 1) return;
      var k = pair.slice(0, i), v;
      try { v = decodeURIComponent(pair.slice(i + 1)); } catch (e) { return; }
      if (k === 'u') out.unit = v === 'si' ? 'si' : 'us';
      else if (k === 't' && isFinite(num(v))) out.tempC = num(v);
      else if (k === 'rh' && isFinite(num(v))) out.rh = num(v);
      else if (k === 'v' && isFinite(num(v))) out.volume = num(v);
      else if (k === 'up' && isFinite(num(v))) out.raise = Math.max(0, num(v));
    });
    return out;
  }

  return {
    P_ATM: P_ATM, RV: RV, CUFT_PER_M3: CUFT_PER_M3, ML_PER_FLOZ: ML_PER_FLOZ, LADLE_ML: LADLE_ML,
    N: N, LIMITS: LIMITS, DEFAULTS: DEFAULTS,
    num: num, round: round, c2f: c2f, f2c: f2c, m3ToCuft: m3ToCuft, cuftToM3: cuftToM3, mlToFlOz: mlToFlOz,
    satPressure: satPressure, satTemp: satTemp, magnus: magnus, vaporDensity: vaporDensity, maxRH: maxRH,
    calc: calc, toQuery: toQuery, fromQuery: fromQuery
  };
});
