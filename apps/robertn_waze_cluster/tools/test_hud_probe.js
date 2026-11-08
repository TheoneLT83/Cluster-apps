'use strict';
/**
 * app/hud_probe.js against a fake diagnostic channel (the kit's diag.js over a fake TASU proxy): a car whose
 * HUD answers, one whose cluster answers and HUD does not, and a channel nothing answers on; the answer kept in
 * <data>/hud.json for the next start. Node 8+.
 *
 *   node tools/test_hud_probe.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = path.join(__dirname, '..');
const REPO = path.join(HERE, '..', '..');
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-probe-'));
fs.cpSync(path.join(REPO, 'kit', 'runtime'), path.join(STAGE, 'kit'), { recursive: true });
fs.copyFileSync(path.join(HERE, 'app', 'hud_probe.js'), path.join(STAGE, 'hud_probe.js'));
const { HudProbe, HUD_ADDRESS } = require(path.join(STAGE, 'hud_probe.js'));

let checks = 0;
const eq = (got, want, msg) => { checks += 1; assert.deepStrictEqual(got, want, msg); };
const log = { info() {}, warn() {}, error() {} };

/* A TASU proxy whose control units at `answering` reply to every request (a positive 0x22 reply). */
function signals(answering) {
    let onResponse = null;
    return {
        proxy: async () => ({}),
        on: async (p, name, fn) => { onResponse = fn; },
        onAvailable: async (p, fn) => fn(true),
        call: async (p, method, req) => {
            if (answering.indexOf(req.targetAddress) >= 0) {
                const frame = [0, 0, 0, 0, 0, 0, req.targetAddress, 0, 0, 0x62].concat(Array.from(req.udsData));
                setTimeout(() => onResponse({ udsResponse: Buffer.from(frame), errorCode: 'NO_ERROR' }), 10);
            }
            return 'NO_ERROR';
        },
    };
}
const probe = (answering, dataDir) => new Promise((resolve) => {
    const p = new HudProbe({ signals: signals(answering), dataDir, log });
    p.run((v) => resolve({ v, p }));
});
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'woc-probe-data-'));

(async () => {
    const d1 = dir();
    let r = await probe([0x60, HUD_ADDRESS], d1);
    eq([r.v, r.p.found()], [true, true], 'the HUD\'s control unit answers: found');
    eq(JSON.parse(fs.readFileSync(path.join(d1, 'hud.json'), 'utf8')).found, true, 'kept for the next start');
    eq(new HudProbe({ signals: signals([]), dataDir: d1, log }).found(), true, 'the next start knows it before asking');

    const d2 = dir();
    r = await probe([0x60], d2);
    eq([r.v, r.p.found()], [false, false], 'the cluster answers, the HUD does not: none');

    const d3 = dir();
    r = await probe([], d3);
    eq([r.v, fs.existsSync(path.join(d3, 'hud.json'))], [null, false], 'nothing answers: not known, nothing kept');

    // a car known to have one keeps that when the channel does not answer
    r = await probe([], d1);
    eq(r.v, true, 'not answering keeps the answer known before');

    console.log('hud probe: ' + checks + ' checks pass');
})().catch((e) => { console.error(e); process.exit(1); });
