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
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('camreq: 1 check passes');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
