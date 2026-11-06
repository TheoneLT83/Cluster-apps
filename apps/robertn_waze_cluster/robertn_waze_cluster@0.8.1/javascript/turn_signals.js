// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * turn_signals - whether the left and right turn signals are on, for the HUD's arrows.
 *
 * Which of the car's signals carries the turn signals is not known yet: no app here reads one, and the
 * catalog of the car's signals is only on the head unit. find() searches that catalog
 * (/etc/oap/someip/someip-interfaces.json, the one MainApp installs apps against) for the fields whose name
 * says turn signal (blink, indicator, turn, Fahrtrichtung, Richtungsanzeige), so the Info page can list
 * them; the one that follows the stalk is read from the next version on.
 *
 * Until then the arrows show for test(): Test left / Test right on the Info page blink that arrow on the HUD.
 *
 *   const ts = new TurnSignals({ catalog });
 *   ts.state()          -> { left, right, test }   (test: the side under test, or null)
 *   ts.test('left')     blinks that arrow for TEST_MS
 *   ts.find()           -> { fields: [{ iface, field }], error: null | 'absent' | 'unreadable' }   (read once, then kept)
 *   ts.on('change', fn)
 */
const fs = require('fs');
const EventEmitter = require('events');

const CATALOG = '/etc/oap/someip/someip-interfaces.json';
const TEST_MS = 6000;
const NAME = /blink|indicat|turn.?sig|turnlight|direction.?ind|fahrtricht|richtungsanz/i;
const MAX_FIELDS = 24;

/* Every key that looks like a turn signal, with the interface it is under; walked without recursion limits
 * mattering for a catalog's depth (an explicit stack). */
function search(db) {
    const out = [], seen = new Set();
    const ifaces = db && db.interfaces && typeof db.interfaces === 'object' ? db.interfaces : db;
    Object.keys(ifaces || {}).forEach((iface) => {
        const stack = [ifaces[iface]];
        while (stack.length && out.length < MAX_FIELDS) {
            const o = stack.pop();
            if (!o || typeof o !== 'object') continue;
            Object.keys(o).forEach((k) => {
                const v = o[k];
                const name = typeof v === 'object' && v && typeof v.name === 'string' ? v.name : k;
                if (NAME.test(name) && !seen.has(iface + '.' + name)) {
                    seen.add(iface + '.' + name);
                    out.push({ iface, field: name });
                }
                if (v && typeof v === 'object') stack.push(v);
            });
        }
    });
    return out.slice(0, MAX_FIELDS);
}

class TurnSignals extends EventEmitter {
    constructor(opts) {
        super();
        const o = opts || {};
        this.catalog = o.catalog || CATALOG;
        this.testing = null;
        this.testTimer = null;
        this.found = null;
    }

    state() {
        return { left: this.testing === 'left', right: this.testing === 'right', test: this.testing };
    }

    test(side) {
        this.testing = side === 'left' || side === 'right' ? side : null;
        clearTimeout(this.testTimer);
        if (this.testing) this.testTimer = setTimeout(() => { this.testing = null; this.emit('change'); }, TEST_MS);
        this.emit('change');
    }

    find() {
        if (this.found) return this.found;
        try {
            this.found = { fields: search(JSON.parse(fs.readFileSync(this.catalog, 'utf8'))), error: null };
        } catch (e) {
            this.found = { fields: [], error: e.code === 'ENOENT' ? 'absent' : 'unreadable' };
        }
        return this.found;
    }
}

module.exports = { TurnSignals, search, CATALOG, TEST_MS };
