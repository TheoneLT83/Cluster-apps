// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * units - the power, torque and boost units the HUD shows them in: the app's own setting, or with Auto the one
 * idrive7-apps' M Vitals, Dyno or Live Data has (their data/settings.json, beside this app's folder on the unit,
 * where it can be read), else kW, Nm and bar.
 *
 *   const u = new Units({ settings, appRoot, log });
 *   u.power(kw) -> { value, unit }    u.torque(nm) -> { value, unit }    u.boost(bar) -> { value, unit, max }
 */
const fs = require('fs');
const path = require('path');

const OTHERS = ['car_vitals', 'dyno', 'live_data'];
const RELOAD_MS = 60000;
const POWER = { kw: [1, 'kW'], hp: [1.34102, 'hp'], ps: [1.35962, 'PS'] };
const TORQUE = { nm: [1, 'Nm'], lbft: [0.737562, 'lb-ft'], kgm: [0.101972, 'kgm'] };
const PRESS = { bar: [1, 'bar'], psi: [14.5038, 'psi'] };
const BOOST_MAX_BAR = 2.0;

/* The settings of the other apps on the unit: each app folder beside this one (oap_<uid>/), its staged id
 * (source/javascript/kit/app-spec.json) one of OTHERS, its data/settings.json; the first of OTHERS that has one. */
function othersSettings(appRoot) {
    const found = {};
    try {
        const parent = path.dirname(appRoot);
        fs.readdirSync(parent).forEach((d) => {
            try {
                const spec = JSON.parse(fs.readFileSync(path.join(parent, d, 'source', 'javascript', 'kit', 'app-spec.json'), 'utf8'));
                if (OTHERS.indexOf(spec.id) < 0) return;
                found[spec.id] = JSON.parse(fs.readFileSync(path.join(parent, d, 'data', 'settings.json'), 'utf8'));
            } catch (e) { /* not an app, or not readable */ }
        });
    } catch (e) { /* no folder to look in */ }
    const id = OTHERS.filter((x) => found[x])[0];
    return id ? { id, values: found[id] } : null;
}

class Units {
    constructor(opts) {
        this.settings = opts.settings;
        this.appRoot = opts.appRoot;
        this.log = opts.log || { info() {} };
        this.other = null; this.read = 0; this.said = '';
    }

    _other() {
        if (Date.now() - this.read > RELOAD_MS) {
            this.read = Date.now();
            this.other = this.appRoot ? othersSettings(this.appRoot) : null;
            const say = this.other ? 'units: from ' + this.other.id : 'units: no other app\'s settings to follow';
            if (say !== this.said) { this.said = say; this.log.info(say); }
        }
        return this.other ? this.other.values : {};
    }

    /* The unit for key: the setting, with Auto the other app's (a unit of table), else the first of table. */
    _unit(key, table) {
        const own = this.settings.get(key);
        if (own && own !== 'auto' && table[own]) return table[own];
        const o = this._other()[key];
        return table[o] || table[Object.keys(table)[0]];
    }

    power(kw) { const [f, unit] = this._unit('powerUnit', POWER); return { value: kw * f, unit }; }

    torque(nm) { const [f, unit] = this._unit('torqueUnit', TORQUE); return { value: nm * f, unit }; }

    boost(bar) {
        const [f, unit] = this._unit('pressUnit', PRESS);
        const max = parseFloat(this._other().boostMax) || BOOST_MAX_BAR;
        return { value: bar * f, unit, max: max * f };
    }
}

module.exports = { Units, othersSettings, BOOST_MAX_BAR };
