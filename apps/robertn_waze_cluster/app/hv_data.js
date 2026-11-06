// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * hv_data - a plug-in hybrid's high-voltage battery for the HUD: the power in or out of it now, and the electric
 * range its charge gives, learned from this car's own electric driving.
 *
 * Read from the battery unit (SME, 0x07) with UDS ReadDataByIdentifier over the head unit's diagnostic link
 * (kit/diag.js, kit/dids.js), the identifiers and scalings idrive7-apps' eDrive uses (its app.json
 * config.battery): pack voltage DDB4 (DD68, DD66, DDEF), current DD69, charge DDBC. Read only while start()ed;
 * a car without such a battery never answers and both stay null.
 *
 *   power  kW, + while the battery gives power (driving on it), - while it takes it (regen, charging)
 *   range  km: the charge above the engine-start point (RESERVE %) x km per %: the car's own from LEARN_MIN_PCT %
 *          of electric driving on (engine off, moving; the last LEARN_KM km), before that DEFAULT_KPP
 *
 *   const hv = new HvData({ signals, log, file });
 *   hv.start(); hv.stop();
 *   hv.feed({ speed, rpm })     the car's speed (km/h) and engine speed, for the learning
 *   hv.power(), hv.range()      number or null
 *   hv.on('change', fn)
 */
const fs = require('fs');
const EventEmitter = require('events');

const ECU = 7;
const VOLTS = [
    { did: 'DDB4', bytes: 2, factor: 0.01, min: 150, max: 500, timeoutMs: 600 },
    { did: 'DD68', bytes: 2, factor: 0.01, min: 150, max: 500 },
    { did: 'DD66', bytes: 2, factor: 0.01, min: 150, max: 500 },
    { did: 'DDEF', bytes: 2, factor: 1, min: 150, max: 500 },
];
const AMPS = [{ did: 'DD69', bytes: 4, factor: 0.01, signed: true, min: -800, max: 800, timeoutMs: 600 }];
const SOC = [{ did: 'DDBC', bytes: 2, factor: 0.1, min: 0, max: 100 }];
const POWER_SIGN = -1;          // the pack's current is + while charging: the battery gives power at - A
const POWER_MS = 500, SOC_MS = 30000, STALE_MS = 5000;
const RESERVE = 8;              // % the engine starts at (eDrive's until it has seen the car's own)
const DEFAULT_KPP = 50 / (100 - RESERVE);   // km per %: 50 km from a full battery (eDrive's at 20 °C)
const LEARN_KM = 60, LEARN_MIN_PCT = 3;
const ENGINE_OFF_RPM = 400;

const num = (v) => typeof v === 'number' && isFinite(v);

class HvData extends EventEmitter {
    constructor(opts) {
        super();
        const o = opts || {};
        this.log = o.log || { info() {}, warn() {} };
        this.signals = o.signals;
        this.file = o.file || null;
        this.kw = null; this.kwT = 0; this.soc = null;
        this.learn = { km: 0, pct: 0 };
        try { const s = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (num(s.km) && num(s.pct)) this.learn = { km: s.km, pct: s.pct }; } catch (e) { /* none yet */ }
        this.leg = null;        // electric driving since the last charge reading: { soc, km }
        this.lastFeed = 0;
        this.reader = null; this.timers = [];
    }

    start() {
        if (this.timers.length || !this.signals) return;
        if (!this.reader) {
            try {
                const { Diag } = require('./kit/diag');
                const { DidReader } = require('./kit/dids');
                const diag = new Diag(this.signals, this.log);
                diag.quiet = true; diag.busyLog = false;
                diag.init();
                this.reader = new DidReader(diag, { ecu: ECU });
            } catch (e) { this.log.warn('hv: ' + e.message); return; }
        }
        let busy = false;
        const read = async () => {
            if (busy) return;
            busy = true;
            try {
                const v = await this.reader.value('hvV', VOLTS), a = v === null ? null : await this.reader.value('hvI', AMPS);
                if (num(v) && num(a)) { this.kw = v * a / 1000 * POWER_SIGN; this.kwT = Date.now(); this.emit('change'); }
            } catch (e) { /* not answered: stays stale */ }
            busy = false;
        };
        const soc = async () => {
            try { const s = await this.reader.value('soc', SOC); if (num(s)) this._onSoc(s); } catch (e) { /* none */ }
        };
        this.timers.push(setInterval(read, POWER_MS), setInterval(soc, SOC_MS));
        setTimeout(soc, 1000);
    }

    stop() {
        this.timers.forEach(clearInterval);
        this.timers = [];
    }

    /* The car's speed and engine speed: km driven on electric power since the last charge reading. */
    feed(d) {
        const now = Date.now(), dt = this.lastFeed ? Math.min(2, (now - this.lastFeed) / 1000) : 0;
        this.lastFeed = now;
        if (!d || !num(d.speed)) return;
        const electric = !(num(d.rpm) && d.rpm >= ENGINE_OFF_RPM);
        if (!electric) { this.leg = null; return; }
        if (this.leg) this.leg.km += d.speed * dt / 3600;
    }

    _onSoc(s) {
        this.soc = s;
        const leg = this.leg;
        if (!leg) {
            this.leg = { soc: s, km: 0 };
        } else if (leg.soc - s >= 1) {
            // a whole % used on electric driving: what it went for
            if (leg.km > 0.2) {
                const f = Math.min(1, LEARN_KM / (this.learn.km + leg.km));
                this.learn = { km: (this.learn.km + leg.km) * f, pct: (this.learn.pct + leg.soc - s) * f };
                try { if (this.file) fs.writeFileSync(this.file, JSON.stringify(this.learn)); } catch (e) { /* kept for the run */ }
            }
            this.leg = { soc: s, km: 0 };
        } else if (s > leg.soc) {
            this.leg = { soc: s, km: 0 };           // charged
        }
        this.emit('change');
    }

    power() {
        return this.kwT && Date.now() - this.kwT < STALE_MS ? this.kw : null;
    }

    kmPerPct() {
        return this.learn.pct >= LEARN_MIN_PCT ? this.learn.km / this.learn.pct : DEFAULT_KPP;
    }

    range() {
        return num(this.soc) ? Math.max(0, this.soc - RESERVE) * this.kmPerPct() : null;
    }
}

module.exports = { HvData, RESERVE, DEFAULT_KPP };
