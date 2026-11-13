// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * more_data.js - the info bars' other readings, from what the car sends by itself (read only):
 *
 *   tyres()    { FL, FR, RL, RR } bar, or null      TPMS.statusTyrePressure (0.1 per bit in the car's pressure unit:
 *              targets()  the same from statusTargetTyrePressure  bar, psi or kPa; each unit's tyre pressures lie apart)
 *   lowTyre()  the tyre(s) LOW_BAR or more under their target (no target: under MIN_BAR)
 *   gearbox()  gearbox oil, deg C, or null            BasicDataSet.basicDataSet valueTemperatureTransmissionOil (- 48)
 *   range()    km left in the tank, or null           KombiIF.statusRangeTankStatus range
 *   clock()    'HH:MM' on the head unit's clock       driveTime() 'H:MM' since the head unit started (the car switched on)
 *
 *   const m = new MoreData({ signals, log }); m.start(); m.on('change', fn)
 */
const EventEmitter = require('events');

const TPMS = 'de.bmw.infotainment.vehicle.TPMS', BASIC = 'de.bmw.infrastructure.analytics.BasicDataSet', KOMBI = 'de.bmw.infotainment.KombiIF';
const WHEELS = { FL: 'FLH', FR: 'FRH', RL: 'RLH', RR: 'RRH' };
const LOW_BAR = 0.3, MIN_BAR = 1.8;

const isNum = (v) => typeof v === 'number' && isFinite(v);
/* A raw tyre pressure in bar: raw x 0.1 is bar (0.5-6), psi (7-60) or kPa (60-600); 65532 and up: none. */
function bar(raw) {
    if (!isNum(raw) || raw >= 65532) return null;
    const v = raw * 0.1;
    if (v >= 0.5 && v <= 6) return v;
    if (v > 6 && v < 60) return v / 14.5038;
    if (v >= 60 && v <= 600) return v / 100;
    return null;
}
const two = (n) => (n < 10 ? '0' : '') + n;

class MoreData extends EventEmitter {
    constructor(o) {
        super();
        this.signals = o.signals; this.log = o.log || { info() {}, warn() {} };
        this.now = o.now || (() => new Date());
        this.started = this.now().getTime();
        this._p = null; this._t = null; this._gear = null; this._range = null;
    }

    start() {
        const watch = (iface, h, opts) => this.signals.watch(iface, '1', h, this.log, opts)
            .catch((e) => this.log.warn(iface.split('.').pop() + ': ' + (e && e.message || e)));
        const wheels = (v, f) => {
            const out = {};
            Object.keys(WHEELS).forEach((w) => { out[w] = bar(v && v[f + WHEELS[w]]); });
            return Object.keys(out).some((w) => out[w] !== null) ? out : null;
        };
        // a car that stands may not send its pressures again: asked every 10 s
        watch(TPMS, {
            statusTyrePressure: (v) => { this._p = wheels(v, 'actualValuePressureTyre'); this.emit('change'); },
            statusTargetTyrePressure: (v) => { this._t = wheels(v, 'targetPressureTyre'); this.emit('change'); },
        }, { pollMs: 10000 });
        watch(BASIC, {
            basicDataSet: (v) => {
                const raw = v && v.valueTemperatureTransmissionOil;
                this._gear = isNum(raw) && raw !== 255 ? raw - 48 : null;
                this.emit('change');
            },
        });
        watch(KOMBI, {
            statusRangeTankStatus: (v) => {
                const r = v && v.range;
                this._range = isNum(r) && r < 4095 ? r : null;
                this.emit('change');
            },
        });
        return this;
    }

    tyres() { return this._p; }
    targets() { return this._t; }
    lowTyre() {
        const p = this._p, t = this._t;
        if (!p) return [];
        return Object.keys(p).filter((w) => isNum(p[w]) && (t && isNum(t[w]) ? p[w] <= t[w] - LOW_BAR : p[w] < MIN_BAR));
    }
    gearbox() { return this._gear; }
    range() { return this._range; }
    clock() { const d = this.now(); return d.getHours() + ':' + two(d.getMinutes()); }
    driveTime() {
        const m = Math.max(0, Math.floor((this.now().getTime() - this.started) / 60000));
        return Math.floor(m / 60) + ':' + two(m % 60);
    }
}

module.exports = { MoreData, bar, LOW_BAR, MIN_BAR };
