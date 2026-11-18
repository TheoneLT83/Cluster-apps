'use strict';
/* app/turnview_camreq.js: the front camera asked at once when the widget starts showing it, not after a wait. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { create } = require('../app/turnview_camreq.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camreq-'));
const file = path.join(dir, 'showing');
let t = 0;
const timers = [];
const setTimer = (fn, ms) => { timers.push({ at: t + ms, fn }); };
const run = (ms) => {
    const end = t + ms;
    for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > end) break;
        const x = timers.shift(); t = x.at; x.fn();
    }
    t = end;
};
let view = { application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: 1 };
const proxy = { CurrentState: { getValue: () => view } };
const cam = create({ someipBuilders: { buildAndInitTypedProxy: (n) => (/XView3D/.test(n) ? Promise.resolve(proxy) : Promise.reject(new Error('no'))) },
    showingFile: file, now: () => t, setTimer });
(async () => {
    fs.writeFileSync(file, 'front\n');
    const mtime = fs.statSync(file).mtime.getTime();
    t = mtime;
    cam.start();
    await new Promise((r) => setImmediate(r));
    let at = null;
    cam.on('change', (s) => { if (s.state === 'on' && at === null) at = t - mtime; });
    for (let i = 0; i < 20 && at === null; i++) { run(100); await new Promise((r) => setImmediate(r)); }
    assert(at !== null && at <= 1000, 'on within 1 s (' + at + ' ms)');
    console.log('ok   the camera\'s front view seen within 1 s of the widget showing it (' + at + ' ms)');
    // Side view: the left camera asked (view 3) at once, and on once the ECU shows it
    const asked = [];
    let sv = { application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: 1 };
    const icam = { currentState: { getValue: () => sv }, changeState: (a) => { asked.push(a.desiredState.perspective); sv = Object.assign({}, sv, { perspective: a.desiredState.perspective }); return Promise.resolve(); },
        clientAttach: () => Promise.resolve({ cookie: 7 }), clientDetach: () => Promise.resolve() };
    const cam2 = create({ someipBuilders: { buildAndInitTypedProxy: (n) => (/ICAM2Proxy/.test(n) ? Promise.resolve(icam) : Promise.reject(new Error('no'))) },
        showingFile: file, now: () => t, setTimer });
    fs.utimesSync(file, new Date(t), new Date(t));
    cam2.start();
    cam2.side('left');
    let st2 = null;
    cam2.on('change', (s) => { st2 = s; });
    for (let i = 0; i < 120 && !(st2 && st2.state === 'on'); i++) { run(100); await new Promise((r) => setImmediate(r)); fs.utimesSync(file, new Date(t), new Date(t)); }
    assert(asked[0] === 3 && st2 && st2.state === 'on' && /left camera on/.test(st2.text), 'the left camera asked and on: ' + JSON.stringify([asked, st2]));
    console.log('ok   side view: the left camera alone asked (view 3) and on');
    // Drive recorder's all cameras (view 7) already on: the front camera is in its frames, nothing asked
    const asked3 = [];
    const dr = { application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: 7 };
    const icam3 = { currentState: { getValue: () => dr }, changeState: (a) => { asked3.push(a.desiredState.perspective); return Promise.resolve(); },
        clientAttach: () => Promise.resolve({ cookie: 8 }), clientDetach: () => Promise.resolve() };
    const cam3 = create({ someipBuilders: { buildAndInitTypedProxy: (n) => (/ICAM2Proxy/.test(n) ? Promise.resolve(icam3) : Promise.reject(new Error('no'))) },
        showingFile: file, now: () => t, setTimer });
    fs.utimesSync(file, new Date(t), new Date(t));
    cam3.start();
    let st3 = null;
    cam3.on('change', (s) => { st3 = s; });
    for (let i = 0; i < 200; i++) { run(100); await new Promise((r) => setImmediate(r)); fs.utimesSync(file, new Date(t), new Date(t)); }
    assert(asked3.length === 0 && st3 && st3.state === 'on', 'view 7 taken as on, nothing asked: ' + JSON.stringify([asked3, st3]));
    console.log('ok   Drive recorder\'s all cameras (view 7) on: Turn View takes it, asks nothing');
    // Side view without camcluster (no showing file): the right camera asked all the same
    fs.rmSync(file, { force: true });
    const asked4 = [];
    let s4 = { application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: 7 };
    const icam4 = { currentState: { getValue: () => s4 }, changeState: (a) => { asked4.push(a.desiredState.perspective); s4 = Object.assign({}, s4, { perspective: a.desiredState.perspective }); return Promise.resolve(); },
        clientAttach: () => Promise.resolve({ cookie: 9 }), clientDetach: () => Promise.resolve() };
    const cam4 = create({ someipBuilders: { buildAndInitTypedProxy: (n) => (/ICAM2Proxy/.test(n) ? Promise.resolve(icam4) : Promise.reject(new Error('no'))) },
        showingFile: file, now: () => t, setTimer });
    cam4.start();
    cam4.side('right');
    let st4 = null;
    cam4.on('change', (s) => { st4 = s; });
    for (let i = 0; i < 120 && !(st4 && st4.state === 'on'); i++) { run(100); await new Promise((r) => setImmediate(r)); }
    assert(asked4[0] === 4 && st4 && /right camera on/.test(st4.text), 'the right camera asked without camcluster: ' + JSON.stringify([asked4, st4]));
    console.log('ok   side view without camcluster: the right camera asked (view 4) and on');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('camreq: 4 checks pass');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
