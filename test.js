/* Checks for humidity.js. Run: node test.js */
'use strict';
const H = require('./humidity.js');
const fs = require('fs');
const path = require('path');

let checks = 0;
const failures = [];
function ok(cond, msg) { checks++; if (!cond) failures.push(msg); }
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol);
const rel = (a, b) => Math.abs(a / b - 1);

/* 1. The constants are the published ones. */
ok(H.P_ATM === 101325, 'standard atmosphere must stay 101325 Pa');
ok(H.RV === 461.5, 'gas constant of water vapor must stay 461.5 J/(kg K)');
ok(near(8.314462618 / 0.01801528, H.RV, 0.05), 'Rv should equal R / M of water');
ok(H.LADLE_ML === 200, 'reference pour must stay 0.2 l (Harvia)');
ok(H.N.length === 11 && H.N[1] === 1167.0521452767 && H.N[10] === 650.17534844798, 'IF97 Table 34 coefficients changed');

/* 2. IAPWS-IF97 computer-program verification values.
      Table 35: ps(300 K) = 0.353658941e-2 MPa, ps(500 K) = 0.263889776e1, ps(600 K) = 0.123443146e2.
      Table 36: Ts(0.1 MPa) = 0.372755919e3 K, Ts(1 MPa) = 0.453035632e3, Ts(10 MPa) = 0.584149488e3. */
[[300, 0.353658941e-2], [500, 0.263889776e1], [600, 0.123443146e2]].forEach(([T, p]) => {
  ok(rel(H.satPressure(T - 273.15) / 1e6, p) < 1e-8, 'IF97 Table 35 mismatch at ' + T + ' K: ' + H.satPressure(T - 273.15) / 1e6);
});
[[0.1, 0.372755919e3], [1, 0.453035632e3], [10, 0.584149488e3]].forEach(([p, T]) => {
  ok(near(H.satTemp(p * 1e6) + 273.15, T, 1e-6), 'IF97 Table 36 mismatch at ' + p + ' MPa: ' + (H.satTemp(p * 1e6) + 273.15));
});

/* 3. NIST Chemistry WebBook, saturation properties of water (retrieved November 2026):
      temperature °C, pressure kPa, vapor density kg/m³. */
const NIST = [
  [10, 1.2282, 0.0094071], [20, 2.3393, 0.017314], [30, 4.2470, 0.030415], [40, 7.3849, 0.051242],
  [50, 12.352, 0.083147], [60, 19.946, 0.13043], [70, 31.201, 0.19843], [80, 47.414, 0.29367],
  [90, 70.182, 0.42390], [100, 101.42, 0.59817], [110, 143.38, 0.82693], [120, 198.67, 1.1221]
];
NIST.forEach(([t, kPa, rho]) => {
  ok(rel(H.satPressure(t) / 1000, kPa) < 0.0002, 'saturation pressure at ' + t + ' °C is ' + H.satPressure(t) / 1000 + ' kPa, NIST ' + kPa);
  // Ideal gas density of saturated vapor: within 2.5% of the real-gas table up to 120 °C, and always on the low side.
  const ideal = H.vaporDensity(t, H.satPressure(t)) / 1000;
  ok(ideal <= rho && rel(ideal, rho) < 0.025, 'ideal gas density at ' + t + ' °C off by ' + (rel(ideal, rho) * 100).toFixed(2) + '%');
});
ok(rel(H.vaporDensity(80, H.satPressure(80)) / 1000, 0.29367) < 0.010, 'ideal gas error at 80 °C should be under 1.0%');
ok(rel(H.vaporDensity(100, H.satPressure(100)) / 1000, 0.59817) < 0.017, 'ideal gas error at 100 °C should be under 1.7%');
// Everyday anchors people quote: 20 °C -> 2.339 kPa; the normal boiling point is 99.974 °C at 101.325 kPa.
ok(near(H.satPressure(20) / 1000, 2.339, 0.001), '20 °C should be 2.339 kPa');
ok(near(H.satTemp(101325), 99.974, 0.001), 'boiling point at one atmosphere should be 99.974 °C');
ok(near(H.satPressure(0), 611.213, 0.01), '0 °C should be 611.213 Pa (IF97 extrapolated value)');

/* 4. Dew point is the exact inverse of saturation pressure. */
for (let t = 0.5; t <= 130; t += 0.5) {
  ok(near(H.satTemp(H.satPressure(t)), t, 1e-7), 'satTemp(satPressure(' + t + ')) drifted');
}

/* 5. Magnus (Alduchov and Eskridge 1996): inside 0.4% over its fitted range above freezing, and reading high in a hot sauna.
      This is the reason the page does not use it. */
for (let t = 0; t <= 50; t += 1) ok(rel(H.magnus(t), H.satPressure(t)) < 0.004, 'Magnus more than 0.4% off at ' + t + ' °C');
ok(near((H.magnus(80) / H.satPressure(80) - 1) * 100, 1.3, 0.05), 'Magnus should read 1.3% high at 80 °C');
ok(near((H.magnus(100) / H.satPressure(100) - 1) * 100, 2.6, 0.05), 'Magnus should read 2.6% high at 100 °C');
ok(near((H.magnus(110) / H.satPressure(110) - 1) * 100, 3.4, 0.05), 'Magnus should read 3.4% high at 110 °C');

/* 6. The ceiling above the boiling point. */
ok(H.maxRH(80) === 100 && H.maxRH(99.9) === 100, 'below boiling the ceiling is 100%');
ok(near(H.maxRH(110), 70.67, 0.01), 'ceiling at 110 °C should be 70.67%, got ' + H.maxRH(110));
ok(near(H.maxRH(120), 51.0, 0.01), 'ceiling at 120 °C should be 51.0%');
ok(H.maxRH(100) < 100 && H.maxRH(100) > 99.9, 'ceiling at exactly 100 °C is just under 100%');
let r = H.calc({ tempC: 110, rh: 80, volume: 10, raise: 0 });
ok(!r.ok && /70\.6%/.test(r.errors.rh), 'a reading above the ceiling must be refused with the limit: ' + JSON.stringify(r.errors));
r = H.calc({ tempC: 110, rh: 60, volume: 10, raise: 20 });
ok(!r.ok && /10\.6 points/.test(r.errors.raise), 'a rise through the ceiling must be refused with the room left');
r = H.calc({ tempC: 110, rh: 60, volume: 10, raise: 10 });
ok(r.ok && r.capped && r.maxRH === 70.6 && r.after.vaporSharePct <= 100, 'a rise under the ceiling must be accepted');
r = H.calc({ tempC: 45, rh: 100, volume: 10, raise: 5 });
ok(!r.ok && /already/.test(r.errors.raise), 'saturated air cannot be raised');

/* 7. The default example, worked by hand.
      80 °C: es = 47.415 kPa. 15% -> e = 7.112 kPa. AH = 7112 / (461.5 x 353.15) = 43.6 g/m³.
      One point of RH = 474.15 Pa -> 2.909 g/m³ -> 17.3 g in 5.9465 m³. Ten points = 173 g = 5.8 fl oz. */
r = H.calc(H.DEFAULTS);
ok(r.ok, 'defaults must be valid');
ok(r.tempF === 176 && r.volumeCuFt === 210, 'defaults should be 176 °F and 210 cu ft');
ok(r.satKPa === 47.41 && r.now.vaporKPa === 7.11, 'default pressures');
ok(r.now.absGm3 === 43.6 && r.after.absGm3 === 72.7, 'default absolute humidity');
ok(r.now.dewPointC === 39.3 && r.now.dewPointF === 103, 'default dew point, got ' + r.now.dewPointC);
ok(r.water.ml === 173 && r.water.flOz === 5.8 && r.water.gramsPerPoint === 17.3, 'default water, got ' + JSON.stringify(r.water));
ok(r.ladle.points === 11.6 && !r.ladle.overflows && r.ladle.flOz === 6.8, 'default pour, got ' + JSON.stringify(r.ladle));
ok(r.now.vaporSharePct === 7 && r.maxRH === 100 && !r.capped, 'default vapor share and ceiling');
ok(near(r.now.dewPointC, H.satTemp(0.15 * H.satPressure(80)), 0.05), 'dew point is not Ts(e)');

/* 8. A grid of rooms: the output always follows the formulas and never contains NaN. */
let combos = 0;
for (let t = 20; t <= 120; t += 5) {
  const cap = H.maxRH(t), es = H.satPressure(t);
  for (const rh of [1, 5, 10, 20, 35, 50, 70, 90, 100]) {
    for (const vol of [1, 5.9465, 12, 40, 100]) {
      for (const up of [0, 1, 5, 10, 30]) {
        const res = H.calc({ tempC: t, rh, volume: vol, raise: up });
        const id = JSON.stringify({ t, rh, vol, up });
        combos++;
        if (rh > cap + 1e-9) { ok(!res.ok && res.errors.rh, id + ': reading above the ceiling accepted'); continue; }
        if (rh + up > cap + 1e-9) { ok(!res.ok && res.errors.raise, id + ': rise above the ceiling accepted'); continue; }
        ok(res.ok, id + ': rejected ' + JSON.stringify(res.errors));
        if (!res.ok) continue;
        ok(!/NaN|undefined|Infinity/.test(JSON.stringify(res)), id + ': NaN in output');
        const ah = es * rh / 100 / (461.5 * (t + 273.15)) * 1000;
        ok(near(res.now.absGm3, ah, 0.051), id + ': absolute humidity is not e / (Rv T)');
        ok(near(res.water.grams, vol * es * up / 100 / (461.5 * (t + 273.15)) * 1000, 0.51), id + ': water is not V x dAH');
        ok(near(res.water.grams, (res.after.absGm3 - res.now.absGm3) * vol, 0.11 * vol + 0.51), id + ': water does not match the before/after table');
        ok(near(res.water.flOz, res.water.ml / 29.5735, 0.07), id + ': fl oz mismatch');
        ok(res.after.rh === H.round(rh + up, 1), id + ': target humidity wrong');
        ok(res.now.vaporSharePct <= 100.05 && res.after.vaporSharePct <= 100.05, id + ': more vapor than air pressure allows');
        if (res.now.dewPointC != null) {
          ok(res.now.dewPointC <= t + 0.05, id + ': dew point above the air temperature');
          ok(near(H.satPressure(res.now.dewPointC), es * rh / 100, es * rh / 100 * 0.004), id + ': dew point does not reproduce the vapor pressure');
          if (rh === 100) ok(near(res.now.dewPointC, t, 0.05), id + ': saturated air must have dew point = temperature');
        } else ok(es * rh / 100 < 611.213, id + ': dew point missing above 0 °C');
        if (res.after.dewPointC != null && res.now.dewPointC != null) ok(res.after.dewPointC >= res.now.dewPointC, id + ': more vapor lowered the dew point');
        ok(res.ladle.points >= 0 && res.ladle.points <= cap - rh + 0.05, id + ': a pour cannot pass the ceiling');
        ok(res.ladle.overflows === (200 / (vol * es / 100 / (461.5 * (t + 273.15)) * 1000) > cap - rh + 1e-9), id + ': overflow flag wrong');
      }
    }
  }
}

/* 9. Monotonic: hotter air, more humidity, a bigger room or a bigger rise never need less water. */
let prev = 0;
for (let t = 20; t <= 99; t += 1) { const g = H.calc({ tempC: t, rh: 10, volume: 10, raise: 10 }).water.grams; ok(g >= prev, 'hotter air needed less water at ' + t); prev = g; }
prev = 0;
for (let v = 1; v <= 100; v += 1) { const g = H.calc({ tempC: 80, rh: 10, volume: v, raise: 10 }).water.grams; ok(g >= prev, 'bigger room needed less water at ' + v); prev = g; }
prev = -1;
for (let up = 0; up <= 80; up += 1) { const g = H.calc({ tempC: 80, rh: 10, volume: 10, raise: up }).water.grams; ok(g > prev, 'bigger rise did not need more water at ' + up); prev = g; }
ok(H.calc({ tempC: 80, rh: 10, volume: 10, raise: 0 }).water.grams === 0, 'no rise, no water');
// Twice the room, twice the water; the starting humidity does not matter for the amount.
ok(near(H.calc({ tempC: 80, rh: 10, volume: 20, raise: 10 }).water.grams, 2 * H.calc({ tempC: 80, rh: 10, volume: 10, raise: 10 }).water.grams, 1), 'water should scale with volume');
ok(H.calc({ tempC: 80, rh: 10, volume: 10, raise: 10 }).water.grams === H.calc({ tempC: 80, rh: 40, volume: 10, raise: 10 }).water.grams, 'ten points cost the same from any start');

/* 10. Very dry air at low temperature: dew point below freezing is reported as missing, not guessed. */
r = H.calc({ tempC: 30, rh: 5, volume: 10, raise: 0 });
ok(r.ok && r.now.dewPointC === null && r.now.dewPointF === null, 'dew point below 0 °C should be null');

/* 11. Bad input is refused with a message, never turned into a number. */
[
  [{}, ['temp', 'rh', 'volume']],
  [null, ['temp', 'rh', 'volume']],
  [{ tempC: 'abc', rh: 10, volume: 10 }, ['temp']],
  [{ tempC: 10, rh: 10, volume: 10 }, ['temp']],
  [{ tempC: 140, rh: 10, volume: 10 }, ['temp']],
  [{ tempC: 80, rh: 0, volume: 10 }, ['rh']],
  [{ tempC: 80, rh: 101, volume: 10 }, ['rh']],
  [{ tempC: 80, rh: 10, volume: 0.5 }, ['volume']],
  [{ tempC: 80, rh: 10, volume: 500 }, ['volume']],
  [{ tempC: 80, rh: 10, volume: 10, raise: -5 }, ['raise']],
  [{ tempC: 80, rh: 10, volume: 10, raise: 'x' }, ['raise']],
  [{ tempC: 80, rh: 95, volume: 10, raise: 10 }, ['raise']]
].forEach(([input, fields]) => {
  const res = H.calc(input);
  ok(!res.ok, 'bad input accepted: ' + JSON.stringify(input));
  fields.forEach((f) => ok(res.errors && typeof res.errors[f] === 'string' && res.errors[f].length > 5, 'no message for ' + f + ' in ' + JSON.stringify(input)));
});
ok(H.calc({ tempC: '80,5', rh: '12,5', volume: '10', raise: '' }).ok, 'decimal comma and an empty rise should be accepted');
ok(H.calc({ tempC: 20, rh: 100, volume: 1 }).ok && H.calc({ tempC: 120, rh: 1, volume: 100 }).ok, 'the limits themselves must be accepted');
ok(H.calc({ tempC: H.f2c(176), rh: 15, volume: H.cuftToM3(210), raise: 10 }).water.ml === 173, 'US units must give the same answer');

/* 12. Units */
ok(near(H.c2f(100), 212) && near(H.f2c(212), 100) && near(H.f2c(H.c2f(83.3)), 83.3), 'temperature conversion');
ok(near(H.m3ToCuft(1), 35.3147) && near(H.cuftToM3(35.3147), 1), 'volume conversion');
ok(near(H.mlToFlOz(29.5735), 1) && near(H.mlToFlOz(200), 6.763, 0.001), 'fluid ounce conversion');

/* 13. Share links round-trip. */
const st = { unit: 'si', tempC: H.f2c(185), rh: 12.5, volume: H.cuftToM3(300), raise: 7.5 };
const back = H.fromQuery('?' + H.toQuery(st));
ok(back.unit === 'si' && back.rh === 12.5 && back.raise === 7.5, 'query flags lost');
ok(near(back.tempC, 85, 0.01) && near(H.m3ToCuft(back.volume), 300, 0.01), 'query numbers lost');
ok(Math.round(H.c2f(back.tempC)) === 185, '°F did not survive the link');
ok(Object.keys(H.fromQuery('?t=abc&rh=&v=%E0%A4%A&junk')).join() === '', 'bad query should be ignored');
ok(H.fromQuery('u=metric').unit === 'us', 'unknown unit should fall back to US');

/* 14. The page and README quote the same numbers the code produces. */
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
const p5 = (v) => Number(v.toPrecision(5)).toString();
[[20, '2.3393'], [50, '12.352'], [80, '47.414'], [100, '101.42'], [110, '143.38']].forEach(([t, nist]) => {
  const ours = p5(H.satPressure(t) / 1000), mag = p5(H.magnus(t) / 1000);
  const pct = (H.magnus(t) / H.satPressure(t) - 1) * 100;
  const sign = pct < 0 ? '−' : '+';
  const row = '<td>' + nist + ' kPa</td><td>' + ours + ' kPa</td><td>' + (mag.length < 6 && t === 80 ? mag + '0' : mag) + ' kPa (' + sign + Math.abs(pct).toFixed(1) + '%)</td>';
  ok(html.includes(row), 'index.html check table row for ' + t + ' °C should be ' + row);
});
ok(/461\.5/.test(html) && /461\.5/.test(readme), '461.5 must be quoted on the page and in the README');
ok(/about 71% at 230 °F \(110 °C\)/.test(html), 'the 110 °C ceiling must be quoted on the page');
ok((html.match(/<h1[\s>]/g) || []).length === 1, 'index.html must have exactly one h1');
ok(/Made by DIVELUX/.test(html) && html.includes('https://diveluxsaunahat.com/pages/sauna-tools'), 'footer credit missing');
['https://iapws.org/technical-guidance/release/IF97-Rev', 'https://webbook.nist.gov/chemistry/fluid/', 'https://www.osti.gov/biblio/548871'].forEach((u) => {
  ok(html.includes(u) && readme.includes(u), 'source link missing: ' + u);
});
ok(!/feels like \d|heat index of/i.test(html), 'no invented felt temperatures');
ok(!/detox|toxin|burns? fat|cure|heals|immune|amazon/i.test(html + readme), 'banned wording');

if (failures.length) {
  console.error(failures.length + ' of ' + checks + ' checks FAILED');
  failures.slice(0, 30).forEach((f) => console.error(' - ' + f));
  process.exit(1);
}
console.log('All ' + checks + ' checks passed (' + combos + ' air and room combinations).');
