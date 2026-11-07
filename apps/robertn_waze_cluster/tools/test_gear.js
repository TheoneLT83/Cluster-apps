// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * The HUD's gear text (app/main.js gearText): D1 ... D9, S1 ... S8 in sport, M1 ... M8 in manual, P / R / N, from
 * the gear, the selector stage and the programme (MDrive's, else the gearbox status's mode).
 *
 *   node tools/test_gear.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
const code = src.match(/const PROGRAMS[\s\S]*?\nfunction gearText[\s\S]*?\n}\n/)[0];
const G = { isNum: (v) => typeof v === 'number' && isFinite(v) };       // eslint-disable-line no-unused-vars
// eslint-disable-next-line no-new-func
const { gearText, PROGRAMS } = new Function('G', code + '; return { gearText, PROGRAMS };')(G);

const cases = [
    [{ stage: 'D', gear: 3 }, 'D3'], [{ stage: 'D', gear: 0 }, 'D'], [{ gear: 4 }, 'D4'],
    [{ stage: 'D', gear: 3, program: 'S' }, 'S3'], [{ stage: 'D', gear: 8, program: 'M' }, 'M8'],
    [{ stage: 'D', gear: 2, mode: 'S' }, 'S2'], [{ stage: 'D', gear: 2, mode: 'M' }, 'M2'], [{ stage: 'D', gear: 2, mode: 'D' }, 'D2'],
    [{ gear: 5, program: 'M' }, 'M5'], [{ stage: 'D', gear: 0, program: 'S' }, 'S'],
    [{ stage: 'P', gear: 0, program: 'S' }, 'P'], [{ stage: 'R', gear: -1 }, 'R'], [{ gear: -1 }, 'R'], [{ gear: 0 }, 'N'],
    [{}, null], [{ program: 'M' }, 'M']];
cases.forEach(([d, want]) => assert.strictEqual(gearText(d), want, JSON.stringify(d)));
assert.deepStrictEqual([PROGRAMS.S_MINUS_PROGRAMM, PROGRAMS.M_MINUS_PROGRAMM, PROGRAMS[1], PROGRAMS[2]], ['S', 'M', 'S', 'M']);
console.log(`gear: ${cases.length + 1} checks pass`);
