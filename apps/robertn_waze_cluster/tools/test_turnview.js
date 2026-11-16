// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// node tools/test_turnview.js - app/turn_view.js against a simulated Turn View tool and waze-on-cluster
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const { TurnView } = require('../app/turn_view.js');
const { gateOpen, mergeSettings } = require('../../../native/turn-view/turnview.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-'));
const SOCK = path.join(dir, 'ctl.sock');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await sleep(20); } throw new Error('timed out: ' + what); };
let passed = 0;
const ok = (c, m) => { assert(c, m); passed++; console.log('ok   ' + m); };

/* The tool: answers get / set / preview / calib / reset as turnview.js does, pushing its state. */
function tool() {
    const t = { got: [], conns: [], signal: false, near: false, settings: { enabled: false, cal: { h: 0.6, pitch: 3, fov: 60, yaw: 0, x: 0 } } };
    // the gate: turnview.js's, Map view selected
    const gate = () => (t.settings.enabled && gateOpen(t.settings.show || 'signal', t.near ? 'near' : 'route', t.signal, true) ? 'open' : 'closed');
    t.push = () => t.conns.forEach((c) => c.write(JSON.stringify({ state: { settings: t.settings, status: { gate: gate(), camera: t.settings.enabled ? 'decoding' : 'off', route: 'none', backend: 'id7' } } }) + '\n'));
    t.server = net.createServer((c) => {
        t.conns.push(c);
        let buf = '';
        c.on('data', (d) => {
            buf += d;
            for (let n; (n = buf.indexOf('\n')) >= 0; buf = buf.slice(n + 1)) {
                const q = JSON.parse(buf.slice(0, n));
                t.got.push(q);
                if (q.op === 'set') t.settings = Object.assign({}, t.settings, q.settings);
                if (q.op === 'signal') t.signal = q.on;
                if (q.op === 'reset') t.settings = { enabled: t.settings.enabled, cal: { h: 0.6, pitch: 3, fov: 60, yaw: 0, x: 0 } };
                t.push();
            }
        });
        c.on('close', () => { t.conns = t.conns.filter((x) => x !== c); });
    });
    return new Promise((r) => t.server.listen(SOCK, () => r(t)));
}
/* waze-on-cluster's choice: shownOn / showOn. */
function map(where) {
    const m = new EventEmitter();
    m.where = where; m.asked = [];
    m.shownOn = () => m.where;
    m.clusterOn = () => m.where === 'cluster' || m.where === 'both';
    m.showOn = (w) => { m.asked.push(w); m.where = w; m.emit('change'); };
    return m;
}
function store() { const v = {}; return { get: (k) => (k in v ? v[k] : null), set: (k, x) => { v[k] = x; }, v }; }
const quiet = { info() {}, warn() {} };

(async () => {
    const t = await tool();
    // a car with a HUD, the map on the cluster
    let m = map('cluster'), st = store();
    let tv = new TurnView({ log: quiet, ctl: m, hudOk: () => true, store: st, path: SOCK }).start();
    await until('connected', () => tv.state);
    ok(!tv.enabled() && m.where === 'cluster', 'off: the map stays where it is');
    tv.enable(true);
    await until('on', () => tv.enabled());
    ok(m.where === 'cluster', 'on, no turn signal and no turn near: the map stays on the cluster');
    tv.signal(true);
    await until('shown', () => m.where === 'hud');
    ok(st.v.tvMapWas === 'cluster', 'a turn signal on: Turn View shows, the map to the HUD alone, its place kept');
    tv.signal(false);
    await until('back', () => m.where === 'cluster');
    ok(st.v.tvMapWas === null, 'the turn signal off: the map back on the cluster');
    t.near = true; t.push();
    await until('near', () => m.where === 'hud');
    ok(true, 'a turn near: Turn View shows again');
    m.showOn('both'); tv.mapChanged();
    ok(m.where === 'hud', 'the map put back on the cluster while it is on: off the cluster again');
    tv.enable(false);
    await until('off', () => !tv.enabled());
    ok(m.where === 'cluster' && st.v.tvMapWas === null, 'off: the map back on the cluster');
    tv.close();

    // a car without a HUD, the map on both
    m = map('both'); st = store(); t.near = true;
    tv = new TurnView({ log: quiet, ctl: m, hudOk: () => false, store: st, path: SOCK }).start();
    await until('connected', () => tv.state);
    tv.enable(true);
    await until('on', () => tv.enabled());
    ok(m.where === 'off' && st.v.tvMapWas === 'both', 'on without a HUD: the map off');
    // the tool goes away (an update): the map back
    t.conns.forEach((c) => c.destroy());
    await until('gone', () => !tv.state);
    ok(m.where === 'both' && st.v.tvMapWas === null, 'the tool gone: the map back');
    await until('again', () => tv.state);
    tv.close();

    // the app started again after the car was switched off with Turn View on: the tool starts off, the map comes back
    t.settings.enabled = false;
    m = map('off'); st = store(); st.set('tvMapWas', 'cluster');
    tv = new TurnView({ log: quiet, ctl: m, hudOk: () => false, store: st, path: SOCK }).start();
    ok(m.where === 'cluster' && st.v.tvMapWas === null, 'a start with the map kept from before: back at once');
    await until('connected', () => tv.state);

    // left on: the tool starts off at the next start of the car, and is switched on again
    tv.close();
    t.settings.enabled = false;
    m = map('cluster'); st = store(); st.set('tvOn', true); t.near = true;
    tv = new TurnView({ log: quiet, ctl: m, hudOk: () => true, store: st, path: SOCK }).start();
    await until('on again', () => tv.enabled());
    ok(m.where === 'hud', 'left on: on again at the next start, the map to the HUD again');
    tv.enable(false);
    await until('off', () => !tv.enabled());
    ok(st.v.tvOn === false && m.where === 'cluster', 'switched off: remembered off, the map back');
    tv.close();
    m = map('cluster'); st.set('tvMapWas', null);
    tv = new TurnView({ log: quiet, ctl: m, hudOk: () => true, store: st, path: SOCK }).start();
    await until('connected', () => tv.state);
    await sleep(200);
    ok(!tv.enabled() && m.where === 'cluster', 'left off: stays off at the next start');

    // calibration: a value a step at a time, within its range, previewed; Save keeps it; Reset the defaults
    tv.calib(true);
    ok(tv.calibrating && tv.draft && tv.draft.h === 0.6, 'calibrate: the saved values to start from');
    tv.nudge('h', 1); tv.nudge('fov', -1);
    await until('preview', () => t.got.some((q) => q.op === 'preview' && q.cal.h === 0.65 && q.cal.fov === 58));
    ok(true, 'calibrate: each step previewed (0.6 -> 0.65 m, 60 -> 58°)');
    for (let i = 0; i < 50; i++) tv.nudge('pitch', -1);
    ok(tv.draft.pitch === 0, 'calibrate: never under its range');
    tv.save();
    await until('saved', () => t.settings.cal.h === 0.65);
    ok(tv.saved && t.settings.cal.fov === 58, 'Save: the tool keeps it');
    tv.reset();
    await until('reset', () => t.settings.cal.h === 0.6);
    tv.calib(false);
    await until('calib off', () => t.got.filter((q) => q.op === 'calib').length === 2);
    ok(t.got.filter((q) => q.op === 'calib').map((q) => q.on).join() === 'true,false', 'the marks on while calibrating, off after');
    // when it shows: the turn only, all the time, as before
    t.signal = false; t.near = false;
    tv.enable(true);
    tv.setShow('always');
    await until('always', () => tv.show() === 'always' && tv.shows());
    ok(true, 'Always: shown with no signal and no turn near');
    tv.setShow('near');
    await until('turn only', () => tv.show() === 'near' && !tv.shows());
    tv.signal(true);
    await sleep(100);
    ok(!tv.shows(), 'Turn only: a turn signal does not show it');
    tv.signal(false);
    tv.setShow('signal');
    await until('signal', () => tv.show() === 'signal');
    ok([['signal', 'route', true, true], ['near', 'near', false, true], ['always', 'none', false, null]].every((a) => gateOpen(...a)) &&
        ![['near', 'route', true, true], ['always', 'none', false, false], ['always', 'off', false, true], ['signal', 'route', false, true]].some((a) => gateOpen(...a)),
        'the tool\'s gate: each choice, never out of Map view or off');
    ok(mergeSettings(null, null).show === 'signal' && mergeSettings({ show: 'near' }, { show: 'bad' }).show === 'near' && mergeSettings(null, { show: 'always' }).show === 'always',
        'the choice: signal by default, kept, only the three');
    // the scene: near a turn the sign chevrons instead of the road arrows, a slight bend keeps the road arrows
    const { createScene } = require('../../../native/turn-view/scene.js');
    let n = 0;
    const sets = {}, unis = [];
    const cr = new Proxy({}, { get: (o, k) => (k === 'set' ? (ref, v) => { if (v && 'visible' in v) sets[ref] = v.visible; }
        : k === 'uniform' ? (ref, name, v) => unis.push([ref, name, v[0]]) : () => ++n) });
    const sc = createScene(cr, { target: 'map' });
    sc.rect({ x: 286, y: 72, w: 504, h: 368 });
    sc.camera('decoding');
    const view = (state, angle, side) => ({ state, video: true, l0: 50, travel: 0, speed: 5, angle, side, exit: 0, icon: '', text: '', alpha: 1, dim: false });
    sc.show(view('route', 90, -1), 0);
    let L = sc.status().layers;
    ok(L.chevrons && !L.sign, 'far from the turn: the road arrows');
    sc.show(view('near', 90, -1), 100);
    L = sc.status().layers;
    ok(!L.chevrons && L.sign && unis.some((u) => u[1] === 'u_side' && u[2] === -1), 'near a left turn: the sign chevrons pointing left, no road arrows');
    sc.show(view('near', 10, 1), 200);
    L = sc.status().layers;
    ok(L.chevrons && !L.sign, 'a slight bend (10 deg): the road arrows');
    const { signScale } = require('../../../native/turn-view/scene.js');
    ok(signScale(100) < 0.5 && signScale(50) > signScale(100) && signScale(15) === 1 && signScale(0) === 1,
        'the chevrons small at 100 m, growing, whole from 15 m (' + [100, 50, 15].map(signScale).join(', ') + ')');
    tv.close();
    t.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`turnview: ${passed} checks pass`);
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
