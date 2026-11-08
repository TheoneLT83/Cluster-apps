'use strict';
/**
 * app/green_light.js: "GO" for a green after a red while the car stands, from BMW's traffic-light display or the
 * camera's lights (the same light), not while moving, not for a green without a red, not twice within QUIET_MS;
 * app/hud_overlay.js puts it on the HUD and the cluster as alerts. Node 8+.
 *
 *   node tools/test_green_light.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const HERE = path.join(__dirname, '..');
const REPO = path.join(HERE, '..', '..');
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-green-'));
fs.cpSync(path.join(REPO, 'kit', 'runtime'), path.join(STAGE, 'kit'), { recursive: true });
['green_light.js', 'hud_overlay.js'].forEach((f) => fs.copyFileSync(path.join(HERE, 'app', f), path.join(STAGE, f)));
fs.copyFileSync(path.join(REPO, 'native', 'cluster-render', 'js', 'cluster_render_client.js'), path.join(STAGE, 'cluster_render_client.js'));
const { GreenLight, foresightColour, QUIET_MS } = require(path.join(STAGE, 'green_light.js'));
const { HudOverlay } = require(path.join(STAGE, 'hud_overlay.js'));

let checks = 0;
const eq = (got, want, msg) => { checks += 1; assert.deepStrictEqual(got, want, msg); };
const log = { info() {}, warn() {}, error() {} };

eq([foresightColour('AMPEL_ROT'), foresightColour(13), foresightColour('AMPEL_GRUEN_PULSIEREND'), foresightColour('STOPPSCHILD')],
    ['red', 'red', 'green', null], 'BMW\'s traffic-light events');

(async () => {
    let t = 0, kmh = 0, foresight = null, camera = null;
    const signals = {
        watch: async (i, inst, h) => { foresight = h.displayForesight; return {}; },
        proxy: async () => ({}),
        on: async (p, name, fn) => { camera = fn; },
    };
    const g = new GreenLight({ signals, log, speed: () => kmh, now: () => t });
    const gos = [];
    g.on('go', (on) => gos.push(on));
    await g.start();
    foresight({ dispForesightEvent: 'AMPEL_GRUEN' });
    eq(gos, [], 'a green without a red: nothing');
    foresight({ dispForesightEvent: 'AMPEL_ROT' }); t += 20000;
    foresight({ dispForesightEvent: 'AMPEL_GRUEN' });
    eq([gos, g.showing()], [[true], true], 'red, then green while standing: GO');
    t += QUIET_MS + 1; kmh = 30;
    foresight({ dispForesightEvent: 'AMPEL_ROT' }); foresight({ dispForesightEvent: 'AMPEL_GRUEN' });
    eq(gos, [true], 'driving: nothing');
    kmh = 0;
    camera({ trafficLightID: 4, trafficLightColor: 1 }); camera({ trafficLightID: 5, trafficLightColor: 3 });
    eq(gos, [true], 'another light\'s green: nothing');
    camera({ trafficLightID: 4, trafficLightColor: 3 });
    eq(gos, [true, true], 'the camera\'s light, red then green: GO');
    camera({ trafficLightID: 6, trafficLightColor: 1 }); t += 1000; camera({ trafficLightID: 6, trafficLightColor: 3 });
    eq(gos, [true, true], 'within the quiet time: nothing');
    g.stop();

    // the overlay: alert layers on the HUD and in the cluster's middle
    const made = [], dropped = [];
    const client = { on() {}, connect() {}, close() {}, set() {}, pixels() {}, image: (o) => { made.push(o); return made.length; }, drop: (r) => dropped.push(r) };
    const hud = new HudOverlay({ log, client });
    hud.go(true, true);
    eq(made.map((o) => [o.target, o.klass]), [['map', 'alert'], ['hud', 'alert']], 'GO on the cluster and the HUD, as alerts');
    hud.go(false, false);
    eq(dropped.length, 2, 'gone after');
    hud.go(false, true);
    eq(made[made.length - 1].target, 'map', 'without the HUD: the cluster only');
    hud.close();
    console.log('green light: ' + checks + ' checks pass');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
