'use strict';
/* app/revs.js: the engine speed's zones on the HUD, warm and with the oil cold. */
const assert = require('assert');
const r = require('../app/revs.js');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const warm = r.zones(7000, 4500, 95);
ok(warm.red === 6300 && warm.yellow === 5500 && !warm.cold, 'petrol, warm: yellow 5500, red 6300');
ok(r.zones(5000, 3000, 95).red === 4300, 'diesel, warm: red 4300');
ok(r.zones(7000, 4500, null).red === 6300, 'no oil temperature: the warm zones');
const cold = r.zones(7000, 4500, 10);
ok(cold.red === 4500 && cold.cold, 'oil at 10 deg C: red from the cold limit');
const half = r.zones(7000, 4500, 55);
ok(half.red > 4500 && half.red < 6300 && half.red % 100 === 0, 'oil warming: red in between, in steps of 100');
ok(r.stage(3000, warm) === 'white' && r.stage(5600, warm) === 'yellow' && r.stage(6300, warm) === 'red', 'stages');
ok(r.stage(4600, cold) === 'red' && r.stage(4600, warm) === 'white', 'cold oil: red sooner');
ok(r.stage(undefined, warm) === 'white', 'no rpm: white');
console.log(`revs: ${n} checks pass`);
