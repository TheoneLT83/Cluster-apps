// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * green_light - the traffic light the car waits at, on the cluster and the HUD: its red (or red and yellow, or yellow)
 * while the car stands at it, then its green with "GO" and BMW's gong. Gone once the car moves.
 *
 * Two of the front camera's (KAFAS) sources, either enough:
 *   - TrafficSignDisplayControl.displayForesight, what BMW's own driver assistance shows: dispForesightEvent
 *     AMPEL_ROT (red), AMPEL_ROT_GELB (red and yellow), AMPEL_GELB (yellow), AMPEL_GRUEN... (green). On cars and
 *     countries where BMW shows traffic lights.
 *   - TrafficLightRecognitionFrontCameraLegacy.RecognitionTrafficLightCamera, the camera's own light objects:
 *     trafficLightColor RAW_RED and RAW_GREEN (the codes are not documented; each code seen is logged once, so a car's
 *     can be read from the log); RAW_NONE is no light.
 * Values come as numbers, enum names or { value } objects (num()). The camera numbers a light anew as it tracks it,
 * so any light counts, not only the same trafficLightID.
 *
 * Shown: a red, red and yellow or yellow light seen within RED_KEEP_MS while the car stands (below STILL_KMH, or no
 * speed known), unless the car drove on for PASSED_MS after it. A green within RED_KEEP_MS of a red while it stands: green with "GO" and the gong for GO_MS (at most
 * one each QUIET_MS). Nothing from MOVE_KMH up. The gong: BMW's gong player (IGPCommand.requestGong), as alexp50's
 * Green Light Alert (bmw-apps, MIT) plays it.
 *
 *   const g = new GreenLight({ signals, log, speed: () => kmh, now });
 *   await g.start();     g.on('show', (s) => ...)   s: null, or { colour: 'red' | 'redyellow' | 'yellow' | 'green', go }
 *   g.shown() -> the same       g.found() -> true (a source answers), false (none did within LOOK_MS), null (looking)
 */
const EventEmitter = require('events');

const FORESIGHT = 'de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl';
const CAMERA = 'de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy';
const GONG = 'de.bmw.infotainment.gp.gongplayer.IGPCommand';
const EVENTS = { AMPEL_ROT: 12, AMPEL_ROT_GELB: 13, AMPEL_GELB: 14, AMPEL_GRUEN: 15, AMPEL_GRUEN_PULSIEREND: 16,
    AMPEL_GRUEN_SCHILD_RECHTS_OBEN: 17, AMPEL_GRUEN_SCHILD_RECHTS_UNTEN: 18 };
const RAW_RED = 1, RAW_GREEN = 3, RAW_NONE = 15;
const STILL_KMH = 3, MOVE_KMH = 5;
const RED_KEEP_MS = 120000;
const GO_MS = 4000;
const QUIET_MS = 10000;
const LOOK_MS = 30000;
const TICK_MS = 500;
const PASSED_MS = 10000;           // moving this long after a red: driven past it, not stopping at it
const GONG_CALL = { location: 0, identifier: 208, duration: 0, type: 16, distance: 0, angle: 0 };

/* An enum as the signal gives it (number, name, numeric text or { value }) -> its number, or null. */
function num(v, names) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v && typeof v === 'object') return num(v.value !== undefined ? v.value : v._value, names);
    if (typeof v === 'string') {
        if (names && names[v] !== undefined) return names[v];
        const n = Number(v);
        return v.trim() !== '' && isFinite(n) ? n : null;
    }
    return null;
}

/* A dispForesightEvent (name, number or { value }) -> 'red' | 'redyellow' | 'yellow' | 'green' | null. */
function foresightColour(ev) {
    const n = num(ev, EVENTS);
    if (n === 12) return 'red';
    if (n === 13) return 'redyellow';
    if (n === 14) return 'yellow';
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
        this.redAt = -Infinity;    // when a light was last red (or red and yellow)
        this.last = null;          // { colour, at }: the last red, red and yellow or yellow light
        this.state = null;         // what is shown: null or { colour, go }
        this.movingSince = null;
        this.goUntil = 0;
        this.lastGo = -Infinity;
        this.rawSeen = [];
        this.timer = null;
        this.startedAt = null;
        this.foresight = null;     // the display's watch, available once its provider answers
        this.cameraUp = false;     // the camera's provider answered, or a light came
        this.gong = null;          // the gong player's proxy
        this.gongHandle = 80;
    }

    async start() {
        this.startedAt = this.now();
        this.timer = setInterval(() => this.tick(), TICK_MS);
        const f = this.foresight = await this.signals.watch(FORESIGHT, '1', { displayForesight: (v) => this.light(foresightColour(v && v.dispForesightEvent)) }, this.log);
        if (f.error) this.log.warn('green light: BMW\'s traffic-light display: ' + f.error);
        try {
            const p = await this.signals.proxy(CAMERA, '1');
            await this.signals.on(p, 'RecognitionTrafficLightCamera', (v) => this.camera(v), this.log);
            if (this.signals.onAvailable) await this.signals.onAvailable(p, (on) => { if (on) this.cameraUp = true; });
        } catch (e) { this.log.warn('green light: the camera\'s traffic lights: ' + (e && e.message || e)); }
        try { this.gong = await this.signals.proxy(GONG, '1'); } catch (e) { this.log.warn('green light: the gong: ' + (e && e.message || e)); }
    }

    /* One light object of the camera. */
    camera(v) {
        if (!v) return;
        this.cameraUp = true;
        const code = num(v.trafficLightColor);
        if (code === null || code === RAW_NONE) return;
        if (this.rawSeen.length < 16 && this.rawSeen.indexOf(code) < 0) {
            this.rawSeen.push(code);
            this.log.info('green light: camera colour code ' + code + ' (light ' + num(v.trafficLightID) + ')');
        }
        this.light(code === RAW_RED ? 'red' : code === RAW_GREEN ? 'green' : null);
    }

    _standing() { const kmh = this.speed(); return !(typeof kmh === 'number' && kmh >= STILL_KMH); }
    _moving() { const kmh = this.speed(); return typeof kmh === 'number' && kmh >= MOVE_KMH; }

    /* A light's colour now. */
    light(colour) {
        const t = this.now();
        if (!colour) return;
        if (colour !== 'green') {
            if (colour !== 'yellow') this.redAt = t;
            this.last = { colour, at: t };
            if (!(this.state && this.state.go)) this.tick();
            return;
        }
        this.last = null;
        if (t - this.redAt > RED_KEEP_MS || !this._standing() || t - this.lastGo < QUIET_MS) { this.tick(); return; }
        this.redAt = -Infinity;
        this.lastGo = t;
        this.goUntil = t + GO_MS;
        this.log.info('green light: green after red');
        this._set({ colour: 'green', go: true });
        this._playGong();
    }

    /* What is shown now: the car moving, the GO over, the red long gone (or driven past: moving PASSED_MS on). */
    tick() {
        const t = this.now();
        if (this._moving()) {
            if (this.movingSince === null) this.movingSince = t;
            if (t - this.movingSince >= PASSED_MS) this.last = null;
            this.goUntil = 0;
            return this._set(null);
        }
        this.movingSince = null;
        if (t < this.goUntil) return null;
        const l = this.last;
        this._set(l && t - l.at <= RED_KEEP_MS && this._standing() ? { colour: l.colour, go: false } : null);
        return null;
    }

    _set(s) {
        const was = this.state;
        if (was === s || (was && s && was.colour === s.colour && was.go === s.go)) return null;
        this.state = s;
        this.emit('show', s);
        return null;
    }

    _playGong() {
        if (!this.gong || !this.signals.call) return;
        this.gongHandle = (this.gongHandle + 1) & 255;
        Promise.resolve(this.signals.call(this.gong, 'requestGong', Object.assign({ handle: this.gongHandle }, GONG_CALL), 2500))
            .catch((e) => this.log.warn('green light: gong: ' + (e && e.message || e)));
    }

    shown() { return this.state; }

    found() {
        if (this.cameraUp || (this.foresight && this.foresight.available)) return true;
        return this.startedAt !== null && this.now() - this.startedAt > LOOK_MS ? false : null;
    }

    stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = { GreenLight, foresightColour, num, RAW_RED, RAW_GREEN, STILL_KMH, MOVE_KMH, GO_MS, QUIET_MS, LOOK_MS, RED_KEEP_MS };
