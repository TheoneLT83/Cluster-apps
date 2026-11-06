// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * The HUD overlay (app/hud_overlay.js) against the cluster renderer on the host with fake displays
 * (native/cluster-render test/host_service): nothing asked of the renderer while there is nothing to show; the
 * gear under the map at its right side (inside its bottom edge without room under it), following the map's size
 * and place; the turn arrows over the map's top
 * corners (above it where the HUD has room, else inside its top edge), never past its sides, blinking (lit and
 * blank pixels in turn) while their side is on, blank and no longer sent once it is off; arrows and gear dropped when their setting is off; the arrows' three sizes; the map's
 * place as waze-on-cluster puts it. The turn signals' catalog search (app/turn_signals.js) too.
 *
 *   make -C native/cluster-render build/host/host_service
 *   node apps/robertn_waze_cluster/tools/test_hud.js native/cluster-render/build/host/host_service
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HERE = path.join(__dirname, '..');
const REPO = path.join(HERE, '..', '..');
// the app's modules as the package has them: javascript/ with kit/ beside them
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-hud-'));
fs.cpSync(path.join(REPO, 'kit', 'runtime'), path.join(STAGE, 'kit'), { recursive: true });
['hud_overlay.js', 'turn_signals.js'].forEach((f) => fs.copyFileSync(path.join(HERE, 'app', f), path.join(STAGE, f)));
fs.copyFileSync(path.join(REPO, 'native', 'cluster-render', 'js', 'cluster_render_client.js'), path.join(STAGE, 'cluster_render_client.js'));
const { HudOverlay, mapRect, rowRect, gearRect, arrowRect, dataRect, ARROW, GEAR_W, GEAR_H, ROW_H, SPEED_END, SPEED_RECT } = require(path.join(STAGE, 'hud_overlay.js'));
const { ClusterRender } = require(path.join(STAGE, 'cluster_render_client.js'));
const { search, TurnSignals } = require(path.join(STAGE, 'turn_signals.js'));

let checks = 0;
const ok = (cond, msg) => { checks++; assert(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.deepStrictEqual(a, b, msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms) {
    for (let t = 0; t < ms; t += 20) { if (cond()) return true; await sleep(20); }
    return cond();
}

async function main() {
    const bin = process.argv[2] || path.join(REPO, 'native', 'cluster-render', 'build', 'host', 'host_service');
    // the map's place, as map_feed.cpp quad() puts it: 60 % wide, the frame's shape kept, centred, moved, held inside
    eq(mapRect(60, [0, 0]), { x: 160, y: 134, w: 480, h: 212 }, '60 %: 480 x 212, centred');
    eq(mapRect(60, [0, -40]), { x: 160, y: 94, w: 480, h: 212 }, 'moved up 40 px');
    eq(mapRect(85, [400, 400]), { x: 120, y: 180, w: 680, h: 300 }, 'held inside the HUD');
    eq(mapRect(0, [0, 0]).w, 456, 'Standard: about 57 %');
    const m = mapRect(60, [0, 0]);
    const [aw, ah] = ARROW.medium;
    // one row under the map: the left arrow after BMW's speed, the gear beside it, the data, the right arrow at the map's right edge
    eq(rowRect(m), { x: 160, y: 352, w: 480, h: ROW_H }, 'the row just under the map');
    const def = mapRect(65, [20, -30]);
    eq(arrowRect(def, 'left', aw, ah), { x: SPEED_END, y: rowRect(def).y + (ROW_H - ah) / 2, w: aw, h: ah },
        'the default map: the left arrow right after BMW\'s speed');
    const small = mapRect(30, [-200, 0]);
    eq(arrowRect(small, 'left', aw, ah).x, Math.round(small.x + small.w * 0.55 - aw), 'a small map far left: short of its middle');
    const wide = mapRect(85, [0, 0]);
    eq(arrowRect(wide, 'left', aw, ah).x, SPEED_END, 'a wide map: the left arrow right after BMW\'s speed');
    eq(arrowRect(m, 'right', aw, ah), { x: 640 - aw - 4, y: rowRect(m).y + (ROW_H - ah) / 2, w: aw, h: ah }, 'the right one at the map\'s right edge');
    const g = gearRect(m, 'medium'), l = arrowRect(m, 'left', aw, ah), d = dataRect(m, 'medium'), r = arrowRect(m, 'right', aw, ah);
    ok(g.x === l.x + l.w + 2 && g.y === rowRect(m).y && g.w === GEAR_W && g.h === GEAR_H, 'the gear beside the left arrow');
    ok(d && d.x > g.x + g.w && d.x + d.w < r.x, 'the data between the gear and the right arrow');
    const low = mapRect(60, [0, 400]);
    eq(rowRect(low).y, low.y + low.h - ROW_H - 4, 'no room under a map at the HUD\'s bottom: inside its bottom edge');
    const lg = arrowRect(m, 'left', ARROW.large[0], ARROW.large[1]);
    ok(lg.h <= ROW_H - 8 && lg.h < ARROW.large[1], 'a large arrow: held to the row');
    eq(dataRect({ x: 300, y: 200, w: 200, h: 88 }, 'large'), null, 'a narrow map: no room for the data');

    const sock = path.join(os.tmpdir(), `woc-hud-${process.pid}.sock`);
    const svc = spawn(bin, [sock], { stdio: ['pipe', 'pipe', 'ignore'] });
    await new Promise((r) => svc.stdout.once('data', r));
    const cr = new ClusterRender('robertn_waze_cluster', sock);
    const sent = [];
    const pixels = cr.pixels.bind(cr);
    cr.pixels = (ref, rects, px) => { sent.push({ ref, lit: px.some((v, i) => i % 4 === 3 && v > 0) }); return pixels(ref, rects, px); };
    const layer = {};
    cr.on('layer', (ref, state) => { layer[ref] = state; });
    const hud = new HudOverlay({ client: cr });
    const base = { turn: {}, gear: null, map: m, arrowSize: 'medium', showTurn: true, showGear: true };
    try {
        hud.update(base);
        await sleep(200);
        eq(hud.state(), 'off', 'nothing to show: the renderer is not asked for anything');

        hud.update(Object.assign({}, base, { gear: 'D3' }));
        ok(await until(() => hud.layers.gear && layer[hud.layers.gear.ref] === 'shown', 2000), 'the gear: shown on the HUD');
        eq([hud.layers.gear.x, hud.layers.gear.y], [gearRect(m, 'medium').x, gearRect(m, 'medium').y], 'beside the left arrow\'s place');
        eq(Object.keys(hud.layers), ['gear'], 'no arrows while no turn signal is on');
        const up = mapRect(60, [0, -40]);
        hud.update(Object.assign({}, base, { gear: 'D3', map: up }));
        eq([hud.layers.gear.x, hud.layers.gear.y], [gearRect(up, 'medium').x, gearRect(up, 'medium').y], 'it follows the map\'s place');
        const n = sent.length;
        hud.update(Object.assign({}, base, { gear: 'D3', map: up }));
        eq(sent.length, n, 'the same gear: nothing sent again');

        hud.update(Object.assign({}, base, { gear: 'D3', turn: { left: true } }));
        const left = hud.layers['arrow-left'];
        const la = arrowRect(m, 'left', aw, ah);
        ok(left && left.x === la.x && left.y === la.y && left.w === aw, 'the left arrow in the row under the map');
        ok(!hud.layers['arrow-right'], 'the right one is not made');
        ok(await until(() => layer[left.ref] === 'shown', 2000), 'shown');
        await sleep(1300);
        const blinks = sent.filter((s) => s.ref === left.ref).map((s) => s.lit);
        ok(blinks.length >= 3 && blinks.some((l) => l) && blinks.some((l) => !l), `it blinks: lit and blank in turn (${blinks})`);
        hud.update(Object.assign({}, base, { gear: 'D3', turn: { right: true }, arrowSize: 'large' }));
        const right = hud.layers['arrow-right'];
        const ra = arrowRect(m, 'right', ARROW.large[0], ARROW.large[1]);
        ok(right && right.x === ra.x && right.w === ra.w, 'the right arrow, large, at the map\'s right edge');
        hud.update(Object.assign({}, base, { gear: 'D3' }));
        await sleep(100);
        const after = sent.length;
        await sleep(900);
        eq(sent.slice(after).length, 0, 'both off: blank, and nothing sent while they stay off');

        hud.update(Object.assign({}, base, { gear: 'D3', data: [{ kind: 'slider', value: -12, min: -60, max: 60, text: '12', green: true }, { kind: 'value', label: 'OIL', text: '92°' }] }));
        const dl = hud.layers.data, dr = dataRect(m, 'medium');
        ok(dl && dl.x === dr.x && dl.y === dr.y && await until(() => layer[dl.ref] === 'shown', 2000), 'the data: shown between the gear and the right arrow');
        const nd = sent.length;
        hud.update(Object.assign({}, base, { gear: 'D3', data: [{ kind: 'slider', value: -12, min: -60, max: 60, text: '12', green: true }, { kind: 'value', label: 'OIL', text: '92°' }] }));
        eq(sent.length, nd, 'the same data: nothing sent again');

        hud.update(Object.assign({}, base, { gear: 'D3', speed: 87 }));
        const sl = hud.layers.speed;
        ok(sl && sl.x === SPEED_RECT.x && sl.y === SPEED_RECT.y && await until(() => layer[sl.ref] === 'shown', 2000), 'the real speed: left of BMW\'s speed');

        hud.update(Object.assign({}, base, { gear: 'D3', showTurn: false, showGear: false }));
        eq(Object.keys(hud.layers), [], 'their settings off, no data: the arrows, the gear and the data are dropped');
    } finally {
        hud.close();
        svc.kill();
        fs.rmSync(STAGE, { recursive: true, force: true });
    }

    // the car's catalog: the fields that may carry the turn signals, with their interface
    const db = { interfaces: {
        'de.bmw.infotainment.vehicle.Lights': { attributes: { statusDirectionIndicator: {}, statusHeadlight: {} } },
        'de.bmw.x.Kombi': { attributes: [{ name: 'blinkerState' }, { name: 'speed' }] } } };
    eq(search(db), [{ iface: 'de.bmw.infotainment.vehicle.Lights', field: 'statusDirectionIndicator' }, { iface: 'de.bmw.x.Kombi', field: 'blinkerState' }],
        'the catalog search: the turn signal fields alone');
    const ts = new TurnSignals({ catalog: '/nonexistent/catalog.json' });
    eq(ts.find(), { fields: [], error: 'absent' }, 'no catalog: said so');
    ts.test('left');
    eq(ts.state(), { left: true, right: false, test: 'left' }, 'Test left: the left arrow on');
    ts.test(null);
    console.log(`hud: ${checks} checks pass`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
