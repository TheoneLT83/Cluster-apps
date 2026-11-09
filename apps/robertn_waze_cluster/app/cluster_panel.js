// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * cluster_panel - the info bar in the middle of the cluster, a little low: up to four live values in a dark
 * see-through pill, drawn as an image layer of the cluster renderer (target `map`, 1088 x 480, over the Waze map).
 *
 *   items: [{ kind: 'power', kw }, { kind: 'value', label: 'OIL', text: '92°', cold: true }, ...]
 *   panelSize(items) -> { w, h }        drawPanel(cv, x, y, items)       panelRect(items) -> where on the target
 *
 * The power: its kW (amber from AMBER_KW, green while recuperating) and a bar from zero (a third along: using
 * fills to the right, blue to purple up to MAX_OUT; recuperating to the left in green up to MAX_IN). A value
 * shown cold (oil or coolant under COLD_C) is blue.
 */
const { withAlpha } = require('./kit/canvas');

const TARGET = { w: 1088, h: 480 };
const H = 96, PAD = 12, POWER_W = 200, VALUE_W = 92;
const PILL = [8, 10, 16, 165], WHITE = '#f2f5f8', LABEL = '#a9b1c2';
const BLUE = '#2f86ff', PURPLE = '#b35cff', GREEN = '#2fd27a', AMBER = '#ffb020', COLD = '#5ab8ff', TRACK = '#22262e';
const AMBER_KW = 60, MAX_OUT = 100, MAX_IN = 60;
const COLD_C = 50;
/* Where it sits: centred, its bottom this far over the map's bottom edge. */
const BOTTOM_GAP = 32;          // clear of the cluster's dimmed edge under the map

const isNum = (v) => typeof v === 'number' && isFinite(v);

function panelSize(items) {
    const w = items.reduce((a, it) => a + (it.kind === 'power' ? POWER_W : VALUE_W), 0);
    return { w: w + 24, h: H - 2 * PAD };
}

function panelRect(items) {
    const s = panelSize(items);
    return { x: Math.round((TARGET.w - s.w) / 2), y: TARGET.h - s.h - BOTTOM_GAP, w: s.w, h: s.h };
}

/* The power's bar, from zero a third along: out to the right (blue to purple), in to the left (green). */
function drawBar(cv, x, y, w, h, kw) {
    cv.roundRect(x, y, w, h, h / 2, TRACK);
    const zero = x + Math.round(w / 3);
    if (isNum(kw) && kw > 0) {
        const len = Math.max(h, (w - (zero - x)) * Math.min(1, kw / MAX_OUT));
        const f = Math.min(1, kw / MAX_OUT);
        cv.roundRect(zero, y, len, h, h / 2, f > 0.5 ? PURPLE : BLUE);
        if (f > 0.25) cv.roundRect(zero, y, len * 0.6, h, h / 2, BLUE);
    } else if (isNum(kw) && kw < 0) {
        const len = Math.max(h, (zero - x) * Math.min(1, -kw / MAX_IN));
        cv.roundRect(zero - len, y, len, h, h / 2, GREEN);
    }
    cv.fillRect(zero - 1, y - 4, 2, h + 8, WHITE);
}

function drawPanel(cv, x, y, items) {
    const s = panelSize(items);
    cv.roundRect(x, y, s.w, s.h, s.h / 2, PILL);
    let cx = x + 12;
    const mid = y + s.h / 2;
    items.forEach((it) => {
        if (it.kind === 'power') {
            const kw = it.kw, has = isNum(kw);
            const text = has ? (Math.abs(kw) < 10 ? kw.toFixed(1) : String(Math.round(kw))) : '--';
            const col = !has ? LABEL : kw < 0 ? GREEN : kw >= AMBER_KW ? AMBER : WHITE;
            cv.text(text, cx + 92, mid + 15, 40, col, { font: 'bold', align: 'right' });
            cv.text('kW', cx + 96, mid + 15, 18, LABEL, { font: 'bold' });
            drawBar(cv, cx + 128, mid - 6, 64, 12, kw);
            cx += POWER_W;
        } else {
            cv.text(it.label, cx + VALUE_W / 2, mid - 12, 14, LABEL, { font: 'bold', align: 'center', spacing: 1 });
            cv.text(it.text, cx + VALUE_W / 2, mid + 24, 32, it.cold ? COLD : it.text === '--' ? LABEL : WHITE, { font: 'bold', align: 'center' });
            cx += VALUE_W;
        }
    });
    return s;
}

module.exports = { drawPanel, panelSize, panelRect, drawBar, TARGET, COLD_C, AMBER_KW, MAX_OUT, MAX_IN, BLUE, GREEN, AMBER, PURPLE, withAlpha };
