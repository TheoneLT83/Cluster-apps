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
const { HudOverlay, mapRect, gearRect, arrowRect, ARROW, GEAR_W, GEAR_H } = require(path.join(STAGE, 'hud_overlay.js'));
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
    eq(gearRect(m), { x: 640 - GEAR_W, y: 346 + 4, w: GEAR_W, h: GEAR_H }, 'the gear under the map, at its right side');
    const low = mapRect(60, [0, 400]);
    eq(gearRect(low).y, low.y + low.h - GEAR_H - 2, 'no room under a map at the HUD\'s bottom: inside its bottom edge');
    const [aw, ah] = ARROW.medium;
    eq(arrowRect(m, 'left', aw, ah), { x: 164, y: 134 - ah - 8, w: aw, h: ah }, 'the left arrow just above the map, at its left side');
    eq(arrowRect(m, 'right', aw, ah), { x: 640 - aw - 4, y: 134 - ah - 8, w: aw, h: ah }, 'the right one at its right side');
    const top = mapRect(60, [0, -400]);
    eq(arrowRect(top, 'left', aw, ah).y, top.y + 6, 'no room above a map at the HUD\'s top: inside its top edge');
    const narrow = { x: 300, y: 200, w: 200, h: 88 }, nr = arrowRect(narrow, 'right', ARROW.large[0], ARROW.large[1]);
    ok(nr.x >= 300 && nr.x + nr.w <= 500 && arrowRect(narrow, 'left', ARROW.large[0], ARROW.large[1]).x + nr.w <= nr.x,
        'a narrow map: smaller arrows, within its sides, apart');

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
        eq([hud.layers.gear.x, hud.layers.gear.y], [gearRect(m).x, gearRect(m).y], 'in the map\'s corner');
        eq(Object.keys(hud.layers), ['gear'], 'no arrows while no turn signal is on');
        const up = mapRect(60, [0, -40]);
        hud.update(Object.assign({}, base, { gear: 'D3', map: up }));
        eq([hud.layers.gear.x, hud.layers.gear.y], [gearRect(up).x, gearRect(up).y], 'it follows the map\'s place');
        const n = sent.length;
        hud.update(Object.assign({}, base, { gear: 'D3', map: up }));
        eq(sent.length, n, 'the same gear: nothing sent again');

        hud.update(Object.assign({}, base, { gear: 'D3', turn: { left: true } }));
        const left = hud.layers['arrow-left'];
        ok(left && left.x === m.x + 4 && left.y === m.y - ARROW.medium[1] - 8 && left.w === ARROW.medium[0], 'the left arrow over the map\'s top-left corner');
        ok(!hud.layers['arrow-right'], 'the right one is not made');
        ok(await until(() => layer[left.ref] === 'shown', 2000), 'shown');
        await sleep(1300);
        const blinks = sent.filter((s) => s.ref === left.ref).map((s) => s.lit);
        ok(blinks.length >= 3 && blinks.some((l) => l) && blinks.some((l) => !l), `it blinks: lit and blank in turn (${blinks})`);
        hud.update(Object.assign({}, base, { gear: 'D3', turn: { right: true }, arrowSize: 'large' }));
        const right = hud.layers['arrow-right'];
        ok(right && right.x === m.x + m.w - ARROW.large[0] - 4 && right.w === ARROW.large[0], 'the right arrow, large, over the map\'s top-right corner');
        hud.update(Object.assign({}, base, { gear: 'D3' }));
        await sleep(100);
        const after = sent.length;
        await sleep(900);
        eq(sent.slice(after).length, 0, 'both off: blank, and nothing sent while they stay off');

        hud.update(Object.assign({}, base, { gear: 'D3', showTurn: false, showGear: false }));
        eq(Object.keys(hud.layers), [], 'their settings off: the arrows and the gear are dropped');
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
