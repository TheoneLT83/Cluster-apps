// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * hv_data - a plug-in hybrid's high-voltage battery for the HUD, from idrive7-apps' eDrive: the power in or out of it
 * now and its real electric range (the range eDrive's Range page has, learned from this car's driving).
 *
 * eDrive reads the battery unit over the head unit's diagnostic link; two apps doing that at once disturb each other,
 * so this app does not: eDrive writes what it has to SHARED, a file anyone may read ({ t, kw, soc, rangeKm }), at each
 * new power reading, and this reads it every READ_MS. While the HUD or the cluster shows the power or the charge, this
 * says so in WANTED ({ t, power, soc }, each second): eDrive 2.8.4 then reads the power as fast as with its own
 * screen open, and the charge too. Only while eDrive is installed (installed(): an app folder beside this one whose
 * staged id is "edrive", or its file seen) is the electric range offered.
 *
 *   const hv = new HvData({ log, appRoot });
 *   hv.start(); hv.stop();
 *   hv.installed()             eDrive is on the unit
 *   hv.power(), hv.range()     kW (+ the battery gives power, - it takes it) and km, or null (eDrive not running,
 *                              or not read lately)
 *   hv.soc()                   the battery's charge, %, or null
 *   hv.powerShown()            the power eased toward the last reading (for a bar that moves smoothly)
 *   hv.want({ power, soc })    what is shown now (WANTED for eDrive)
 *   hv.on('change', fn)
 */
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const SHARED = '/tmp/mgu-edrive.json', WANTED = '/tmp/mgu-edrive-wanted.json';
const WANT_MS = 1000, EASE_MS = 120;
const READ_MS = 100, POWER_FRESH_MS = 5000, RANGE_FRESH_MS = 120000, LOOK_MS = 60000;
const EDRIVE = 'edrive';

const num = (v) => typeof v === 'number' && isFinite(v);

class HvData extends EventEmitter {
    constructor(opts) {
        const o = opts || {};
        super();
        this.log = o.log || { info() {}, warn() {} };
        this.appRoot = o.appRoot || null;
        this.file = o.file || SHARED;
        this.last = null; this.text = '';
        this.found = null; this.lookedAt = 0;
        this.timer = null;
        this.wanted = { power: false, soc: false };
        this.wantedAt = 0;
        this.shownKw = null; this.shownAt = 0;
    }

    start() {
        if (this.timer) return;
        const read = () => {
            let text = '';
            try { text = fs.readFileSync(this.file, 'utf8'); } catch (e) { /* eDrive not running */ }
            if (text === this.text) return;
            this.text = text;
            try { this.last = text ? JSON.parse(text) : null; } catch (e) { this.last = null; }
            this.emit('change');
        };
        read();
        this.timer = setInterval(() => { read(); this._tellWanted(); }, READ_MS);
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
    }

    /* eDrive is on the unit: an app folder beside this one holding it (looked at once a minute), or its file seen. */
    installed() {
        if (this.last || fs.existsSync(this.file)) return true;
        if (Date.now() - this.lookedAt > LOOK_MS) {
            this.lookedAt = Date.now();
            const was = this.found;
            this.found = false;
            try {
                const parent = path.dirname(this.appRoot);
                this.found = fs.readdirSync(parent).some((d) => {
                    try {
                        return JSON.parse(fs.readFileSync(path.join(parent, d, 'source', 'javascript', 'kit', 'app-spec.json'), 'utf8')).id === EDRIVE;
                    } catch (e) { return false; }
                });
            } catch (e) { /* nothing to look in */ }
            if (was !== this.found) this.log.info('eDrive ' + (this.found ? 'is installed: the electric range from it' : 'is not installed: no electric range'));
        }
        return !!this.found;
    }

    want(w) {
        this.wanted = { power: !!(w && w.power), soc: !!(w && w.soc) };
    }

    /* WANTED, each second while something is wanted: eDrive reads fast for it. */
    _tellWanted() {
        const w = this.wanted;
        if (!(w.power || w.soc) || Date.now() - this.wantedAt < WANT_MS) return;
        this.wantedAt = Date.now();
        try {
            fs.writeFileSync(WANTED + '.tmp', JSON.stringify({ t: Date.now(), power: w.power, soc: w.soc }), { mode: 0o644 });
            fs.renameSync(WANTED + '.tmp', WANTED);
        } catch (e) { /* /tmp not writable: eDrive reads at its own pace */ }
    }

    soc() {
        const l = this._fresh(RANGE_FRESH_MS);
        return l && num(l.soc) ? l.soc : null;
    }

    powerShown() {
        const kw = this.power(), now = Date.now();
        if (kw === null) { this.shownKw = null; return null; }
        if (this.shownKw === null) this.shownKw = kw;
        else this.shownKw += (kw - this.shownKw) * Math.min(1, (now - this.shownAt) / EASE_MS);
        this.shownAt = now;
        return this.shownKw;
    }

    _fresh(ms) {
        return this.last && num(this.last.t) && Date.now() - this.last.t < ms ? this.last : null;
    }

    power() {
        const l = this._fresh(POWER_FRESH_MS);
        return l && num(l.kw) ? l.kw : null;
    }

    range() {
        const l = this._fresh(RANGE_FRESH_MS);
        return l && num(l.rangeKm) ? l.rangeKm : null;
    }
}

module.exports = { HvData, SHARED, WANTED };
