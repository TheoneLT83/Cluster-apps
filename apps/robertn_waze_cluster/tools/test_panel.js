'use strict';
/**
 * app/cluster_panel.js: the info bar's size and place (middle of the cluster's map, low) and its drawing with each
 * item; app/hv_data.js: eDrive's charge, the power eased, and WANTED written while the power or charge is shown.
 *
 *   node tools/test_panel.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HERE = path.join(__dirname, '..');
const REPO = path.join(HERE, '..', '..');
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-panel-'));
fs.cpSync(path.join(REPO, 'kit', 'runtime'), path.join(STAGE, 'kit'), { recursive: true });
['cluster_panel.js', 'hv_data.js'].forEach((f) => fs.copyFileSync(path.join(HERE, 'app', f), path.join(STAGE, f)));
const P = require(path.join(STAGE, 'cluster_panel.js'));
const { HvData } = require(path.join(STAGE, 'hv_data.js'));
const { Canvas } = require(path.join(STAGE, 'kit', 'canvas'));

let checks = 0;
const ok = (c, msg) => { checks += 1; assert(c, msg); };
const items = [{ kind: 'power', kw: 18.4 }, { kind: 'value', label: 'SOC', text: '64%' }, { kind: 'value', label: 'OIL', text: '38°', cold: true }];
const r = P.panelRect(items);
ok(Math.abs(r.x + r.w / 2 - 544) <= 1 && r.y + r.h < 480 && r.y > 240, 'centred, in the lower half of the map');
const lit = (cv) => { let n = 0; for (let i = 3; i < cv.d.length; i += 4) if (cv.d[i]) n++; return n; };
[18.4, -13, 74, null].forEach((kw) => {
    const its = [{ kind: 'power', kw }].concat(items.slice(1)), s = P.panelSize(its), cv = new Canvas(s.w, s.h).clear([0, 0, 0, 0]);
    P.drawPanel(cv, 0, 0, its);
    ok(lit(cv) > s.w * s.h * 0.5, 'drawn with ' + kw + ' kW');
});
ok(P.panelSize([{ kind: 'value', label: 'OIL', text: '90°' }]).w < P.panelSize(items).w, 'narrower with fewer items');

const file = path.join(STAGE, 'edrive.json');
fs.writeFileSync(file, JSON.stringify({ t: Date.now(), kw: 20, soc: 64.5, rangeKm: 30 }));
const hv = new HvData({ file });
hv.start();
ok(hv.soc() === 64.5 && hv.power() === 20, 'charge and power from eDrive');
ok(hv.powerShown() === 20, 'the first shown power is the reading');
fs.writeFileSync(file, JSON.stringify({ t: Date.now(), kw: 40, soc: 64.5 }));
setTimeout(() => {
    const a = hv.powerShown();
    ok(a > 20 && a <= 40, 'eased toward a new reading: ' + a);
    hv.want({ power: true, soc: false });
    setTimeout(() => {
        const w = JSON.parse(fs.readFileSync('/tmp/mgu-edrive-wanted.json', 'utf8'));
        ok(w.power === true && w.soc === false && Date.now() - w.t < 2000, 'WANTED says the power is shown');
        // eDrive 2.9: the battery's limits; a new file is seen at once (the folder watched), not at the next look
        fs.writeFileSync(file + '.tmp', JSON.stringify({ t: Date.now(), kw: 55, soc: 64, limitOut: 110, limitIn: 45 }));
        fs.renameSync(file + '.tmp', file);
        const seenAt = Date.now();
        hv.once('change', () => {
            ok(Date.now() - seenAt < 60 && hv.power() === 55, 'a new file seen at once (' + (Date.now() - seenAt) + ' ms)');
            ok(hv.limits().out === 110 && hv.limits().in === 45, 'the battery\'s limits from eDrive');

            hv.stop();
            console.log('panel: ' + checks + ' checks pass');
            process.exit(0);
        });
    }, 300);
}, 150);
