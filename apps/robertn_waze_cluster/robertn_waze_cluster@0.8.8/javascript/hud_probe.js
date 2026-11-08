// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * Whether the car has a head-up display: its control unit (HUD, diagnostic address 0x3D on F- and G-series)
 * answers a diagnostic request over the head unit's own channel (kit/diag.js, TASU). The instrument cluster
 * (KOMBI, 0x60) is asked first: only when it answers does the HUD's silence mean there is none. The answer is
 * kept in <data>/hud.json, so the app knows it from its next start on; it is asked again at every start.
 *
 *   const probe = new HudProbe({ signals, dataDir, log });
 *   probe.found()        -> true | false | null (not known yet: the channel did not answer)
 *   probe.run(cb)        cb(found) once the request is answered (or not)
 */
const fs = require('fs');
const path = require('path');
const { Diag, hex } = require('./kit/diag');

const KOMBI = 0x60, HUD = 0x3D;
const READ_DID = 0x22, SGBD_INDEX = [0xF1, 0x50];
const TIMEOUT_MS = 4000, TRIES = 3;

class HudProbe {
    constructor(opts) {
        this.signals = opts.signals;
        this.log = opts.log;
        this.file = opts.dataDir ? path.join(opts.dataDir, 'hud.json') : null;
        this.value = null;
        try { const v = JSON.parse(fs.readFileSync(this.file, 'utf8')).found; this.value = typeof v === 'boolean' ? v : null; } catch (e) { /* not asked yet */ }
    }

    found() { return this.value; }

    /* Asks the cluster, then the HUD; up to TRIES times when the cluster does not answer (the channel busy or
     * not up yet). Never throws. */
    run(cb) {
        const done = (v, why) => {
            if (v !== null) {
                if (v !== this.value) this.log.info('HUD: ' + (v ? 'found' : 'none on this car') + ' (' + why + ')');
                this.value = v;
                try { fs.writeFileSync(this.file + '.tmp', JSON.stringify({ found: v, at: Date.now() }) + '\n'); fs.renameSync(this.file + '.tmp', this.file); }
                catch (e) { this.log.warn('HUD: saving the answer: ' + e.message); }
            } else this.log.warn('HUD: not known (' + why + '); its settings stay shown');
            if (cb) try { cb(this.value); } catch (e) { this.log.error('HUD probe: ' + e.message); }
        };
        const ask = async (tries) => {
            const diag = await new Diag(this.signals, this.log).init();
            diag.quiet = true;
            if (diag.error) return done(null, 'the diagnostic channel: ' + diag.error);
            for (let i = 0; i < tries; i++) {
                const kombi = await diag.physical(KOMBI, READ_DID, SGBD_INDEX, TIMEOUT_MS).catch(() => null);
                if (!kombi) continue;
                const hud = await diag.physical(HUD, READ_DID, SGBD_INDEX, TIMEOUT_MS).catch(() => null);
                return done(!!hud, hud ? 'its control unit 0x' + hex(HUD) + ' answered' : 'the cluster answered, the control unit 0x' + hex(HUD) + ' did not');
            }
            return done(null, 'the instrument cluster did not answer');
        };
        ask(TRIES).catch((e) => done(null, e.message));
    }
}

module.exports = { HudProbe, HUD_ADDRESS: HUD };
