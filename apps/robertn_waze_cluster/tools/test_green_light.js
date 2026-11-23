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
['green_light.js', 'hud_overlay.js', 'cluster_panel.js'].forEach((f) => fs.copyFileSync(path.join(HERE, 'app', f), path.join(STAGE, f)));
fs.copyFileSync(path.join(REPO, 'native', 'cluster-render', 'js', 'cluster_render_client.js'), path.join(STAGE, 'cluster_render_client.js'));
const { GreenLight, foresightColour, QUIET_MS, LOOK_MS, GO_MS, RED_KEEP_MS } = require(path.join(STAGE, 'green_light.js'));
const { HudOverlay } = require(path.join(STAGE, 'hud_overlay.js'));

let checks = 0;
const eq = (got, want, msg) => { checks += 1; assert.deepStrictEqual(got, want, msg); };
const log = { info() {}, warn() {}, error() {} };

eq([foresightColour('AMPEL_ROT'), foresightColour(13), foresightColour('AMPEL_GELB'), foresightColour('AMPEL_GRUEN_PULSIEREND'),
    foresightColour('STOPPSCHILD'), foresightColour({ value: 15 }), foresightColour('12')],
    ['red', 'redyellow', 'yellow', 'green', null, 'green', 'red'], 'BMW\'s traffic-light events, as numbers, names, text or { value }');

(async () => {
    let t = 0, kmh = 0, foresight = null, camera = null;
    const gongs = [];
    const signals = {
        watch: async (i, inst, h) => { foresight = h.displayForesight; return {}; },
        proxy: async () => ({}),
        on: async (p, name, fn) => { camera = fn; },
        call: async (p, m, v) => { gongs.push([m, v.identifier]); },
    };
    const g = new GreenLight({ signals, log, speed: () => kmh, now: () => t });
    const shown = [];
    const name = (s) => (s ? s.colour + (s.go ? ' GO' : '') : 'none');
    g.on('show', (s) => shown.push(name(s)));
    await g.start();
    clearInterval(g.timer);            // ticked by hand
    eq(g.found(), null, 'just started: still looking for the camera');
    t += LOOK_MS + 1;
    eq(g.found(), false, 'nothing answered: no traffic-light camera');
    t -= LOOK_MS + 1;
    kmh = 0; foresight({ dispForesightEvent: 'AMPEL_GRUEN' });
    eq([shown, gongs], [['green'], []], 'a green without a red, slow: green, no GO');
    kmh = 30; t += 500; g.tick();
    eq(shown[shown.length - 1], 'none', 'over 10 km/h: gone');
    foresight({ dispForesightEvent: 'AMPEL_ROT' });
    eq(shown[shown.length - 1], 'none', 'a red seen at 30 km/h: nothing yet');
    kmh = 9; t += 500; g.tick();
    eq(shown[shown.length - 1], 'red', 'slowing to 9 km/h toward it: red');
    kmh = 0; t += 20000; foresight({ dispForesightEvent: 'AMPEL_ROT_GELB' });
    eq(shown[shown.length - 1], 'redyellow', 'red and yellow');
    foresight({ dispForesightEvent: 'AMPEL_GRUEN' });
    eq([shown.slice(-1), gongs], [['green GO'], [['requestGong', 208]]], 'green after red: GO and the gong');
    t += GO_MS + 1; kmh = 6; g.tick();
    eq(shown[shown.length - 1], 'green', 'rolling off at 6 km/h after the GO: green');
    kmh = 12; t += 500; g.tick();
    eq(shown[shown.length - 1], 'none', 'past 10 km/h: gone');
    t += 10001; g.tick(); kmh = 5; t += 500; g.tick();
    eq(shown[shown.length - 1], 'none', 'slow again after driving on: the passed light forgotten');
    t += QUIET_MS + 1; kmh = 0;
    camera({ trafficLightID: 4, trafficLightColor: { value: 1 } }); camera({ trafficLightID: 4, trafficLightColor: 15 });
    eq(g.found(), true, 'the camera\'s lights came: found');
    eq(shown[shown.length - 1], 'red', 'the camera\'s red (as { value }), code 15 (no light) left out');
    camera({ trafficLightID: 5, trafficLightColor: 3 });
    eq(shown[shown.length - 1], 'green GO', 'the camera\'s green (renumbered): GO');
    t += GO_MS + 1; g.tick();
    camera({ trafficLightID: 8, trafficLightColor: 1 }); t += 1000; camera({ trafficLightID: 8, trafficLightColor: 3 });
    eq(shown.slice(-2), ['red', 'green'], 'within the quiet time: green without a second GO');
    t += QUIET_MS + 1; camera({ trafficLightID: 9, trafficLightColor: 6 });
    eq(shown[shown.length - 1], 'red', 'another code than green or none (a car\'s own red): red');
    t += 1000; camera({ trafficLightID: 9, trafficLightColor: 3 });
    eq(shown[shown.length - 1], 'green GO', 'its green after it: GO');
    t += GO_MS + 1; g.tick();
    kmh = null; t += 500; g.tick();
    eq(shown[shown.length - 1], 'none', 'no speed known: nothing');
    kmh = 0; t += RED_KEEP_MS + 1; g.tick();
    eq(shown[shown.length - 1], 'none', 'a light seen long ago: gone');
    g.stop();

    // the overlay: alert layers on the HUD and in the cluster's middle
    const made = [], dropped = [];
    const client = { on() {}, connect() {}, close() {}, set() {}, pixels() {}, image: (o) => { made.push(o); return made.length; }, drop: (r) => dropped.push(r) };
    const hud = new HudOverlay({ log, client });
    hud.go({ colour: 'red', go: false }, true, true);
    eq(made.map((o) => [o.target, o.klass]), [['map', 'alert'], ['hud', 'alert']], 'the light on the cluster and the HUD, as alerts');
    hud.go(null, true, true);
    eq(dropped.length, 2, 'gone after');
    hud.go({ colour: 'green', go: true }, false, true);
    eq(made[made.length - 1].target, 'map', 'without the HUD: the cluster only');
    hud.close();
    console.log('green light: ' + checks + ' checks pass');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
