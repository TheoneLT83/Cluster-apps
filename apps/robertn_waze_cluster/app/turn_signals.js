// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * turn_signals - whether the left and right turn signals are on, for the HUD's arrows.
 *
 * From the car: de.bmw.body.Light instance 1, field StatusFunctionsIndicators (notify only, no getter: its value
 * comes when subscribed and on each change), member activeFunctionIndicateDirection, what the lamps do. It holds
 * steady while the stalk or the hazard switch is set (the arrows' blink is the HUD overlay's own):
 *
 *   DAUERBLINKEN_LINKS, TIPPBLINKEN_LINKS     left (latched, or the comfort blink of a tap)
 *   DAUERBLINKEN_RECHTS, TIPPBLINKEN_RECHTS   right
 *   WARNBLINKEN_MANUELL, CRASH_BLINKEN        both (hazard)
 *   anything else (BLINKEN_AUS ...)           none
 *
 * Read on a G-series iDrive 7 car parked: each change within 0.1-0.3 s of the stalk.
 *
 *   const ts = new TurnSignals({ signals, log });
 *   ts.start();
 *   ts.state()          -> { left, right, test }   (test: the side under test, or null)
 *   ts.test('left')     that arrow on for TEST_MS
 *   ts.on('change', fn)
 */
const EventEmitter = require('events');

const IFACE = 'de.bmw.body.Light', INSTANCE = '1', FIELD = 'StatusFunctionsIndicators';
const TEST_MS = 6000;
const SIDES = {
    DAUERBLINKEN_LINKS: 'left', TIPPBLINKEN_LINKS: 'left',
    DAUERBLINKEN_RECHTS: 'right', TIPPBLINKEN_RECHTS: 'right',
    WARNBLINKEN_MANUELL: 'both', CRASH_BLINKEN: 'both',
};

/* What a StatusFunctionsIndicators value says: 'left', 'right', 'both' or null. */
function sideOf(v) {
    return (v && SIDES[v.activeFunctionIndicateDirection]) || null;
}

class TurnSignals extends EventEmitter {
    constructor(opts) {
        super();
        const o = opts || {};
        this.signals = o.signals;
        this.log = o.log || { info() {}, warn() {} };
        this.car = null;
        this.testing = null;
        this.testTimer = null;
    }

    start() {
        if (!this.signals) return;
        this.signals.watch(IFACE, INSTANCE, { [FIELD]: (v) => this.onValue(v) }, this.log)
            .then((s) => this.log.info('turn signals: ' + (s.error ? 'unavailable: ' + s.error : 'subscribed to ' + IFACE + '.' + FIELD)))
            .catch((e) => this.log.warn('turn signals: ' + e.message));
    }

    onValue(v) {
        const side = sideOf(v);
        if (side === this.car) return;
        this.car = side;
        this.emit('change');
    }

    state() {
        const s = this.testing || this.car;
        return { left: s === 'left' || s === 'both', right: s === 'right' || s === 'both', test: this.testing };
    }

    test(side) {
        this.testing = side === 'left' || side === 'right' ? side : null;
        clearTimeout(this.testTimer);
        if (this.testing) this.testTimer = setTimeout(() => { this.testing = null; this.emit('change'); }, TEST_MS);
        this.emit('change');
    }
}

module.exports = { TurnSignals, sideOf, IFACE, FIELD, TEST_MS };
