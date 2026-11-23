'use strict';
/**
 * revs.js - the engine speed's zones on the HUD: white, yellow from `yellow` rpm, red from `red` rpm (the shift point),
 * after WoodyCode23's HUD (woody-apps, apps/woodr_hud/strip.js 0.9.3 and 0.9.4, GPL-3.0).
 *
 *   zones(redline, coldLimit, oil) -> { yellow, red, cold }
 *       red 700 rpm under the engine's redline (kit/engine.js: petrol 7000, diesel 5000), yellow 800 rpm under red.
 *       While the oil is cold the red starts lower: coldLimit rpm at COLD_OIL deg C and below, climbing in a straight
 *       line to the warm red at READY_OIL, in steps of 100. Guidance on the careful side, not a BMW figure; with no
 *       oil temperature known the zones are the warm ones.
 *   stage(rpm, z) -> 'white' | 'yellow' | 'red'
 *   COLOURS[stage]
 */
const COLD_OIL = 20, READY_OIL = 90;
const COLOURS = { white: '#f2f5f8', yellow: '#ffd34d', red: '#ff1f3d' };

function zones(redline, coldLimit, oil) {
    const red = Math.round((Number(redline) || 7000) - 700), warm = { yellow: red - 800, red, cold: false };
    if (typeof oil !== 'number' || !isFinite(oil) || oil >= READY_OIL) return warm;
    const lo = Math.min(red, Number(coldLimit) || red), f = Math.max(0, (oil - COLD_OIL) / (READY_OIL - COLD_OIL));
    const r = Math.round((lo + f * (red - lo)) / 100) * 100;
    if (r >= red) return warm;
    return { yellow: Math.max(0, r - 800), red: r, cold: true };
}

function stage(rpm, z) {
    if (typeof rpm !== 'number' || !isFinite(rpm)) return 'white';
    return rpm >= z.red ? 'red' : rpm >= z.yellow ? 'yellow' : 'white';
}

module.exports = { zones, stage, COLOURS, COLD_OIL, READY_OIL };
