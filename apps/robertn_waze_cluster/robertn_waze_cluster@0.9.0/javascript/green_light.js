// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * green_light - the traffic light ahead turned green while the car waits at it: "GO" on the cluster and the HUD.
 *
 * Two of the front camera's (KAFAS) sources, either enough:
 *   - TrafficSignDisplayControl.displayForesight, what BMW's own driver assistance shows: dispForesightEvent
 *     AMPEL_ROT / AMPEL_ROT_GELB (red), AMPEL_GRUEN... (green). On cars and countries where BMW shows traffic lights.
 *   - TrafficLightRecognitionFrontCameraLegacy.RecognitionTrafficLightCamera, the camera's own light objects:
 *     trafficLightColor per trafficLightID, RAW_RED and RAW_GREEN (the codes are not documented; each code seen is
 *     logged once, so a car's can be read from the log).
 * A green after a red of the same light (the raw source: the same trafficLightID) within RED_KEEP_MS, while the car
 * stands (below STILL_KMH), shows "GO" for GO_MS; at most one each QUIET_MS.
 *
 *   const g = new GreenLight({ signals, log, speed: () => kmh, now });
 *   await g.start();     g.on('go', (on) => ...)      g.showing() -> true while "GO" is up
 */
const EventEmitter = require('events');

const FORESIGHT = 'de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl';
const CAMERA = 'de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy';
const RED_EVENTS = { AMPEL_ROT: 12, AMPEL_ROT_GELB: 13 };
const GREEN_EVENTS = { AMPEL_GRUEN: 15, AMPEL_GRUEN_PULSIEREND: 16, AMPEL_GRUEN_SCHILD_RECHTS_OBEN: 17, AMPEL_GRUEN_SCHILD_RECHTS_UNTEN: 18 };
const RAW_RED = 1, RAW_GREEN = 3;
const STILL_KMH = 3;
const RED_KEEP_MS = 120000;
const GO_MS = 4000;
const QUIET_MS = 10000;

/* A dispForesightEvent (name or number) -> 'red' | 'green' | null. */
function foresightColour(ev) {
    const n = typeof ev === 'number' ? ev : (RED_EVENTS[ev] !== undefined ? RED_EVENTS[ev] : GREEN_EVENTS[ev]);
    if (n === 12 || n === 13) return 'red';
    if (n >= 15 && n <= 18) return 'green';
    return null;
}

class GreenLight extends EventEmitter {
    constructor(o) {
        super();
        this.signals = o.signals;
        this.log = o.log;
        this.speed = o.speed || (() => null);
        this.now = o.now || Date.now;
        this.redAt = {};          // light ('foresight' or the camera's id) -> when it was last red
        this.goUntil = 0;
        this.lastGo = -Infinity;
        this.rawSeen = [];
        this.timer = null;
    }

    async start() {
        const f = await this.signals.watch(FORESIGHT, '1', { displayForesight: (v) => this.light('foresight', foresightColour(v && v.dispForesightEvent)) }, this.log);
        if (f.error) this.log.warn('green light: BMW\'s traffic-light display: ' + f.error);
        try {
            const p = await this.signals.proxy(CAMERA, '1');
            await this.signals.on(p, 'RecognitionTrafficLightCamera', (v) => this.camera(v), this.log);
        } catch (e) { this.log.warn('green light: the camera\'s traffic lights: ' + (e && e.message || e)); }
    }

    /* One light object of the camera. */
    camera(v) {
        if (!v) return;
        const code = Number(v.trafficLightColor);
        if (this.rawSeen.length < 16 && this.rawSeen.indexOf(code) < 0) {
            this.rawSeen.push(code);
            this.log.info('green light: camera colour code ' + code + ' (light ' + v.trafficLightID + ')');
        }
        this.light('camera-' + v.trafficLightID, code === RAW_RED ? 'red' : code === RAW_GREEN ? 'green' : null);
    }

    /* A light's colour now. */
    light(id, colour) {
        const t = this.now();
        if (colour === 'red') { this.redAt[id] = t; return; }
        if (colour !== 'green' || this.redAt[id] === undefined) return;
        const wasRed = t - this.redAt[id] <= RED_KEEP_MS;
        delete this.redAt[id];
        const kmh = this.speed();
        if (!wasRed || !(typeof kmh === 'number' && kmh < STILL_KMH) || t - this.lastGo < QUIET_MS) return;
        this.lastGo = t;
        this.goUntil = t + GO_MS;
        this.log.info('green light: green after red (' + id + ')');
        this.emit('go', true);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; this.emit('go', false); }, GO_MS);
    }

    showing() { return this.now() < this.goUntil; }

    stop() { clearTimeout(this.timer); this.timer = null; }
}

module.exports = { GreenLight, foresightColour, RAW_RED, RAW_GREEN, STILL_KMH, GO_MS, QUIET_MS };
