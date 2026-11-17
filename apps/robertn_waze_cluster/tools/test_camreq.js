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
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('camreq: 2 checks pass');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
