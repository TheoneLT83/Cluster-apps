// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * turn_view.js - Turn View (IterioDev's, native/turn-view) in Cluster functions: the tool's control socket, the camera
 * request (turnview_camreq.js) and the Waze map out of its way.
 *
 *   control socket  /run/turn-view/ctl.sock, JSON lines:
 *     -> { op: 'get' | 'reset' } | { op: 'set', settings: { enabled?, cal? } } | { op: 'preview', cal } | { op: 'calib', on }
 *        | { op: 'camreq', state }
 *     <- { state: { settings: { enabled, cal: { h, pitch, fov, yaw, x } }, status: { camera, rect, route, provider,
 *          maneuver, cr, nav, state, camreq, widget, backend } } }
 *   The tool starts off at every start of the car; the driver's last choice is kept here ('tvOn') and asked of it again
 *   once it answers, so Turn View left on comes back on. It draws the camera into the cluster's central map area (Map view).
 *
 *   The tool shows the camera only while a turn signal is on (tv.signal) or the turn is near, and Map view is selected
 *   (its status.gate 'open'); otherwise the cluster keeps the Waze map.
 *   Waze: while Turn View shows, the map leaves the cluster - to the HUD on a car with one (shown on HUD only), off
 *   without (shown nowhere); the place it had is kept (store) and given back when Turn View goes off, the tool goes
 *   away or the car starts again with Turn View off.
 *
 *   const tv = new TurnView({ log, ctl, hudOk, store, camreq? }); tv.start(); tv.on('change', fn)
 *   tv.state -> the tool's last state (null: not connected)    tv.enable(on)
 *   tv.calib(on) / tv.nudge(key, steps) / tv.save() / tv.reset()    tv.draft -> the calibration shown while calibrating
 *   tv.camStatus() -> { state, text } of the camera request
 */
const EventEmitter = require('events');
const net = require('net');

const CTL = process.env.TURNVIEW_CTL || '/run/turn-view/ctl.sock';
const RETRY_MS = 2000;
/* The calibration: each value's range, step and decimals (the Turn View app's sliders), the tool's default. */
const CAL = {
    h: { label: 'Camera height', min: 0.3, max: 1.2, step: 0.05, decimals: 2, unit: ' m' },
    pitch: { label: 'Tilt down', min: 0, max: 30, step: 0.5, decimals: 1, unit: '°' },
    fov: { label: 'Field of view', min: 30, max: 120, step: 2, decimals: 0, unit: '°' },
    yaw: { label: 'Left / right aim', min: -10, max: 10, step: 0.5, decimals: 1, unit: '°' },
    x: { label: 'Left / right offset', min: -0.5, max: 0.5, step: 0.05, decimals: 2, unit: ' m' },
};

class TurnView extends EventEmitter {
    constructor(o) {
        super();
        this.log = o.log || { info() {}, warn() {} };
        this.ctl = o.ctl;                 // waze_cluster_control: shownOn() / showOn(where)
        this.hudOk = o.hudOk || (() => true);
        this.store = o.store;             // get(key) / set(key, v): the map's place before Turn View ('tvMapWas')
        this.path = o.path || CTL;
        this.cam = o.camreq || null;
        this.state = null;
        this.draft = null;
        this.calibrating = false;
        this.saved = false;
        this.sock = null;
        this.connecting = false;
        this.closed = false;
    }

    start() {
        if (this.cam) {
            this.cam.on('change', () => { this._camreq(); this.emit('change'); });
            this.cam.start();
        }
        this._connect();
        // the place the map had when the app stopped with Turn View on (the car switched off): back at once, the tool is off
        // at every start (if it is on after all, its state takes the map away again)
        this._mapBack();
        return this;
    }

    close() {
        this.closed = true;
        if (this.sock) this.sock.destroy();
        if (this.cam) this.cam.release();
    }

    _connect() {
        if (this.sock || this.connecting || this.closed) return;
        this.connecting = true;
        const s = net.connect(this.path);
        let buf = '';
        s.setEncoding('utf8');
        s.on('connect', () => {
            this.connecting = false; this.sock = s;
            this.log.info('turn view: connected to the tool');
            this._camreq();
            this._send({ op: 'get' });
            if (this.signalOn) this._send({ op: 'signal', on: true });
            if (this.calibrating) { this._send({ op: 'calib', on: true }); if (this.draft) this._send({ op: 'preview', cal: this.draft }); }
        });
        s.on('data', (d) => {
            buf += d;
            for (let n; (n = buf.indexOf('\n')) >= 0; buf = buf.slice(n + 1)) {
                let m;
                try { m = JSON.parse(buf.slice(0, n)); } catch (e) { continue; }
                if (m && m.state) this._onState(m.state);
            }
        });
        s.on('error', (e) => { if (!/ENOENT|ECONNREFUSED/.test(e.code)) this.log.warn('turn view: ' + e.message); });
        s.on('close', () => {
            const had = !!this.sock;
            this.connecting = false; this.sock = null; this.state = null;
            if (had) { this.log.info('turn view: the tool went away'); this._mapBack(); this.emit('change'); }
            if (!this.closed) setTimeout(() => this._connect(), RETRY_MS);
        });
    }
    _send(q) { if (this.sock) this.sock.write(JSON.stringify(q) + '\n'); }
    _camreq() { if (this.cam) this._send({ op: 'camreq', state: this.cam.status().state }); }

    _onState(st) {
        const first = !this.state;
        this.state = st;
        const on = !!(st.settings && st.settings.enabled);
        // the tool's first state after a start (it starts off): the driver's last choice again
        if (first && !on && this.store.get('tvOn') === true) { this.log.info('turn view: on again, as left'); this.enable(true); }
        if (this.shows()) this._mapAway(); else this._mapBack();
        if (this.calibrating && !this.draft && st.settings && st.settings.cal) this.draft = Object.assign({}, st.settings.cal);
        this.emit('change');
    }

    /* Turn View on: the map off the cluster (to the HUD where there is one, else off), its place kept. */
    _mapAway() {
        const now = this.ctl.shownOn();
        if (now !== 'cluster' && now !== 'both') return;        // not on the cluster (or waze-on-cluster not answering yet)
        if (this.store.get('tvMapWas') == null) this.store.set('tvMapWas', now);
        const want = this.hudOk() ? 'hud' : 'off';
        this.log.info('turn view: on, the map from ' + now + ' to ' + want);
        this.ctl.showOn(want);
    }
    /* Turn View off (or gone): the map back where it was. */
    _mapBack() {
        const was = this.store.get('tvMapWas');
        if (was == null) return;
        const now = this.ctl.shownOn();
        if (now === null || now === undefined) return;          // later, once waze-on-cluster answers
        this.store.set('tvMapWas', null);
        if (now !== was) { this.log.info('turn view: off, the map back to ' + was); this.ctl.showOn(was); }
    }
    /* waze-on-cluster's state changed (it answered, or the driver moved the map): the rule again. */
    mapChanged() {
        if (this.shows()) this._mapAway(); else this._mapBack();
    }
    /* On and showing now (a tool without the gate: whenever on). */
    shows() {
        const st = this.state;
        return !!(st && st.settings && st.settings.enabled) && !(st.status && st.status.gate === 'closed');
    }
    /* A turn signal on or off, for the tool's gate. */
    signal(on) { on = !!on; if (on !== this.signalOn) { this.signalOn = on; this._send({ op: 'signal', on }); } }
    /* Side view: 'left' / 'right' (that camera alone, while Turn View is off) or null: the camera unit asked for that
     * side meanwhile; waze-on-cluster's second copy shows it (WazeClusterControl.showSide). */
    side(v) {
        v = v === 'left' || v === 'right' ? v : null;
        if (v === (this.sideNow || null)) return;
        this.sideNow = v;
        if (this.cam && this.cam.side) this.cam.side(v);
    }
    /* The tool is there to show it (it answers). */
    present() { return !!this.state; }

    enabled() { return !!(this.state && this.state.settings && this.state.settings.enabled); }
    enable(on) {
        on = !!on;
        this.store.set('tvOn', on);
        const send = () => this._send({ op: 'set', settings: { enabled: on } });
        // the map leaves the cluster only while the tool shows (its gate open: _onState)
        return send();
    }

    /* When it shows in Map view: 'signal' (a turn signal on or the turn near), 'near' (the turn near), 'always'. */
    show() { const st = this.state; return (st && st.settings && st.settings.show) || 'near'; }
    setShow(v) { this._send({ op: 'set', settings: { show: v } }); }

    calib(on) {
        on = !!on;
        if (on === this.calibrating) return;
        this.calibrating = on; this.saved = false;
        this.draft = on && this.state && this.state.settings ? Object.assign({}, this.state.settings.cal) : null;
        this._send({ op: 'calib', on });
        this.emit('change');
    }
    /* One value a step up (+1) or down (-1), previewed by the tool (Save keeps it). */
    nudge(key, steps) {
        const c = CAL[key];
        if (!c || !this.draft) return;
        const v = Math.max(c.min, Math.min(c.max, Math.round(((this.draft[key] || 0) + steps * c.step) / c.step) * c.step));
        this.draft = Object.assign({}, this.draft, { [key]: Number(v.toFixed(c.decimals)) });
        this.saved = false;
        this._send({ op: 'preview', cal: this.draft });
        this.emit('change');
    }
    save() { if (this.draft) { this._send({ op: 'set', settings: { cal: this.draft } }); this.saved = true; this.emit('change'); } }
    reset() { this._send({ op: 'reset' }); this.draft = null; this.saved = false; this.emit('change'); }
    camStatus() { return this.cam ? this.cam.status() : { state: 'idle', text: 'not available here' }; }
}

module.exports = { TurnView, CAL, CTL };
