// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * more_data.js - the info bars' other readings, from what the car sends by itself (read only):
 *
 *   tyres()    { FL, FR, RL, RR } bar, or null      TPMS.statusTyrePressure (0.1 per bit in the car's pressure unit:
 *              targets()  the same from statusTargetTyrePressure  bar, psi or kPa; each unit's tyre pressures lie apart)
 *   lowTyre()  the tyre(s) LOW_BAR or more under their target (no target: under MIN_BAR)
 *   gearbox()  gearbox oil, deg C, or null            BasicDataSet.basicDataSet valueTemperatureTransmissionOil (- 48); a
 *              car that leaves it empty: the gearbox unit (EGS 0x18) asked over the diagnostic link, as M Vitals does,
 *              while wantGearbox(true): ZF 8HP 22 6000 (deg C + 40), else 22 DA12 (deg C + 48), every EGS_MS (never with the
 *              car locked and left, its VehicleCondition parked or standby: the car can sleep)
 *   range()    km left in the tank, or null           KombiIF.statusRangeTankStatus range
 *   clock()    'H:MM' as the car's clock shows it: UTC and the time zone set in BMW's menu, from the cluster
 *              (KombiIF.timeDateUTC: statusTimeZonesId, a CommonTypes.TimeZone, and summer time when
 *              offsetWintertimeSummertimeUTC is 1); without it the head unit's own clock
 *   driveTime() 'H:MM' since the head unit started (the car switched on)
 *
 *   const m = new MoreData({ signals, log, diag }); m.start(); m.on('change', fn)
 */
const EventEmitter = require('events');

const TPMS = 'de.bmw.infotainment.vehicle.TPMS', BASIC = 'de.bmw.infrastructure.analytics.BasicDataSet', KOMBI = 'de.bmw.infotainment.KombiIF';
const WHEELS = { FL: 'FLH', FR: 'FRH', RL: 'RLH', RR: 'RRH' };
const LOW_BAR = 0.3, MIN_BAR = 1.8;
const EGS = 0x18, EGS_MS = 5000, BASIC_WAIT_MS = 10000;
const CONDITION = 'de.bmw.infrastructure.VehicleCondition';
// statusConditionVehicle, names or wire numbers (the kit's car.js): 1-3 = parked or standby, nobody in the car
const CONDITIONS = { PARKEN_BN_NIO: 1, PARKEN_BN_IO: 2, STANDFUNKTIONEN_KUNDE_NICHT_IM_FZG: 3, WOHNEN: 5,
    PRUEFEN_ANALYSE_DIAGNOSE: 7, FAHRBEREITSCHAFT_HERSTELLEN: 8, FAHREN: 10, FAHRBEREITSCHAFT_BEENDEN: 12 };
const EGS_DIDS = [{ did: [0x60, 0x00], offset: -40 }, { did: [0xda, 0x12], offset: -48 }];
/* CommonTypes.TimeZone: the enum's numbers in order with their offsets from UTC, minutes (UNKNOWN 0 has none). */
const ZONES = [null, -660, -600, -540, -480, -480, -480, -420, -420, -420, -420, -360, -360, -360, -360, -360, -300, -300, -300, -300,
    -270, -240, -240, -240, -240, -240, -240, -240, -210, -180, -180, -180, -180, -180, -60, -60, 0, 0, 0, 60, 60, 60, 60,
    120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 180, 180, 210, 240, 240, 240, 240, 240, 300, 300, 300, 330, 345, 360, 360,
    390, 420, 420, 480, 480, 480, 540, 540, 570, 570, 600, 600, 600, 600, 600, 660, 660, 720, 720, 720];

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
        this.diag = o.diag || null; this._egs = null; this._wantGear = false; this._basicT = 0; this._left = false; this._offset = null; this._zoneLogged = false;
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
        // the car locked and left (its own state: parked or standby, nobody in it): the gearbox unit is not asked, so
        // the car can sleep (with the car off its broadcast stops, which is when the unit would be asked)
        watch(CONDITION, {
            VehicleCondition: (v) => {
                const raw = v && v.statusConditionVehicle, n = typeof raw === 'number' ? raw : CONDITIONS[raw];
                if (!(n >= 1 && n <= 12) || this._left === (n <= 3)) return;
                this._left = n <= 3;
                this.log.info(this._left ? 'the car is locked and left: the gearbox unit is not asked, so it can sleep'
                    : 'the car is in use again');
            },
        });
        watch(BASIC, {
            basicDataSet: (v) => {
                const raw = v && v.valueTemperatureTransmissionOil;
                if (isNum(raw) && raw !== 255) { this._gear = raw - 48; this._basicT = Date.now(); this.emit('change'); }
            },
        });
        watch(KOMBI, {
            timeDateUTC: (v) => {
                const id = v && v.statusTimeZonesId, summer = v && v.offsetWintertimeSummertimeUTC;
                if (!this._zoneLogged && v) { this._zoneLogged = true; this.log.info('clock: zone ' + id + ', summer ' + summer + ', auto ' + v.timeZonesOffsetAutomaticallyUTC); }
                const base = isNum(id) ? ZONES[id] : null;
                this._offset = isNum(base) ? base + (summer === 1 ? 60 : 0) : null;
                this.emit('change');
            },
            statusRangeTankStatus: (v) => {
                const r = v && v.range;
                this._range = isNum(r) && r < 4095 ? r : null;
                this.emit('change');
            },
        });
        setInterval(() => this._askEgs(), EGS_MS);
        return this;
    }

    /* The gearbox unit asked while the gearbox oil is shown and the car's broadcast has none (recently). */
    wantGearbox(on) { this._wantGear = !!on; }
    _askEgs() {
        if (!this.diag || !this._wantGear || this._left || this._asking || Date.now() - this._basicT < BASIC_WAIT_MS) return;
        const tries = this._egs ? [this._egs] : EGS_DIDS;
        this._asking = true;
        const next = (i) => {
            if (i >= tries.length) { this._asking = false; return; }
            const c = tries[i];
            this.diag.physical(EGS, 0x22, c.did, 2500, (u) => (u[0] === 0x62 && u[1] === c.did[0] && u[2] === c.did[1]) || (u[0] === 0x7f && u[1] === 0x22))
                .then((u) => {
                    if (u && u[0] === 0x62 && u.length > 3 && u[3] !== 0xff) {
                        if (!this._egs) this.log.info('gearbox oil: from the gearbox unit, 22 ' + c.did.map((b) => b.toString(16)).join(''));
                        this._egs = c; this._gear = u[3] + c.offset; this.emit('change');
                        this._asking = false;
                    } else next(i + 1);
                }, () => next(i + 1));
        };
        next(0);
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
    clock() {
        const d = this.now();
        if (this._offset === null) return d.getHours() + ':' + two(d.getMinutes());
        const m = ((Math.floor(d.getTime() / 60000) + this._offset) % 1440 + 1440) % 1440;
        return Math.floor(m / 60) + ':' + two(m % 60);
    }
    driveTime() {
        const m = Math.max(0, Math.floor((this.now().getTime() - this.started) / 60000));
        return Math.floor(m / 60) + ':' + two(m % 60);
    }
}

module.exports = { MoreData, bar, LOW_BAR, MIN_BAR, ZONES };
