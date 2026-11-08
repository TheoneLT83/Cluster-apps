// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * hud_overlay - the turn signals and the gear on the HUD, as image layers of the cluster renderer
 * (cluster_render_client.js, target `hud`, 800 x 480), over BMW's own HUD content and the map:
 *
 *   one row under the map (inside its bottom edge when the HUD has no room under it), within its sides:
 *   left arrow           after BMW's own speed reading (SPEED_END), blinking (BLINK_MS on, BLINK_MS off, lit first) while
 *                        that turn signal is on
 *   gear                 beside the left arrow: P, R, N, D or D1 ... D9
 *   data                 between the gear and the right arrow, the one reading chosen: the electric range with the
 *                        eDrive power, oil and coolant, boost, power and torque, or engine speed (sliders carry their
 *                        value in the knob)
 *   right arrow          at the map's right edge
 *   real speed           left of BMW's own speed reading, in its row (SPEED_RECT, where the HUD has room for its
 *                        digits): the car's own speed, for a car whose mileage blocker stops BMW's
 *
 * The HUD shows black as nothing: each layer is drawn on transparent pixels and only what is lit shows.
 * A layer stays visible once made and an arrow that is off is sent as blank pixels, so the HUD's slot is not
 * asked for and given back on every blink. Nothing is made while the overlay has nothing to show.
 *
 *   const hud = new HudOverlay({ log });
 *   hud.update({ turn: { left, right }, gear: 'D3', map: { x, y, w, h }, arrowSize: 'medium', showTurn: true, showGear: true,
 *                data: [{ kind: 'slider', value, min, max, text }, { kind: 'value', label: 'OIL', text: '92°' }, ...], speed: 87 });
 *   hud.state()      -> 'off' | 'waiting' | 'shown' | 'disabled' | 'unavailable' (the HUD target, as the renderer says)
 *   hud.close();
 */
const { ClusterRender } = require('./cluster_render_client.js');
const { Canvas } = require('./kit/canvas');

const HUD_W = 800, HUD_H = 480;
/* BMW's own indicator's pace: about 1.5 flashes a second */
const BLINK_MS = 330;
/* The arrow, one size, its tail short: the space it leaves goes to the data */
const ARROW = { medium: [34, 26] };
const ROW_H = 46;
const GEAR_W = 38, GEAR_H = ROW_H;          // D1 ... D9 at 36 px are 36 wide
/* Where BMW's own speed reading (its km/h) ends on the HUD, from a photo of a G-series HUD: the left arrow
 * comes after it. */
const SPEED_END = 356;
/* The real speed, left of BMW's own speed and right of its speed-limit sign (the same photo), right-aligned. */
const SPEED_RECT = { x: 200, y: 328, w: 70, h: 52 };
const MAX_KW = 60;
const GREEN = '#25e05a', WHITE = '#f2f5f8', AMBER = '#ffb020', DIM = '#8d98a3';

/* The map's place on the HUD as waze-on-cluster puts it (map_feed.cpp quad): its width as a share of the HUD's
 * (0: the fitted box, about 57 %), the frame's shape kept (1088 x 480), centred, then moved by the offset and held
 * inside the HUD. */
function mapRect(widthPct, offset) {
    const pct = Math.min(85, widthPct || 57);
    let w = Math.round(HUD_W * pct / 100), h = Math.round(w * 480 / 1088);
    if (h > HUD_H) { h = HUD_H; w = Math.round(h * 1088 / 480); }
    const o = offset || [0, 0];
    const x = Math.max(0, Math.min(HUD_W - w, Math.round((HUD_W - w) / 2) + o[0]));
    const y = Math.max(0, Math.min(HUD_H - h, Math.round((HUD_H - h) / 2) + o[1]));
    return { x, y, w, h };
}

/* What the turn signals, the gear and the data are placed by: a map of the Standard size centred where the map is
 * (held inside the HUD), so the map's size moves none of them; moving the map moves them with it. */
function anchorRect(map) {
    const s = mapRect(0, [0, 0]), cx = map.x + map.w / 2, cy = map.y + map.h / 2;
    return { x: Math.max(0, Math.min(HUD_W - s.w, Math.round(cx - s.w / 2))), y: Math.max(0, Math.min(HUD_H - s.h, Math.round(cy - s.h / 2))),
        w: s.w, h: s.h };
}

/* The row under the map's Standard-size box (anchorRect); inside its bottom edge when the HUD has no room under it. */
function rowRect(map) {
    const a = anchorRect(map), below = a.y + a.h;
    return { x: a.x, y: below + ROW_H <= HUD_H ? below : Math.max(0, a.y + a.h - ROW_H - 4), w: a.w, h: ROW_H };
}

/* Where an arrow of aw x ah goes in the row: the left one after BMW's speed reading (short of the box's middle), the
 * right one at the box's right edge. */
function arrowRect(map, side, aw, ah) {
    const a = anchorRect(map), row = rowRect(map), k = Math.min(1, (ROW_H - 8) / ah);
    const w = Math.round(aw * k), h = Math.round(ah * k), y = row.y + Math.round((ROW_H - h) / 2);
    if (side === 'right') return { x: a.x + a.w - w - 4, y, w, h };
    return { x: Math.round(Math.max(a.x + 4, Math.min(SPEED_END, a.x + a.w * 0.55 - w))), y, w, h };
}

/* The gear, beside the left arrow. */
function gearRect(map, arrowSize) {
    const [aw, ah] = ARROW[arrowSize] || ARROW.medium, a = arrowRect(map, 'left', aw, ah);
    return { x: a.x + a.w + 2, y: rowRect(map).y, w: GEAR_W, h: GEAR_H };
}

/* The data, between the gear and the right arrow; null when there is no room. */
function dataRect(map, arrowSize) {
    const [aw, ah] = ARROW[arrowSize] || ARROW.medium, g = gearRect(map, arrowSize), r = arrowRect(map, 'right', aw, ah);
    const x = g.x + g.w + 12, w = r.x - 8 - x;
    return w >= 40 ? { x, y: g.y, w, h: ROW_H } : null;
}

/* The data items across x, y (the row's top) to x + w, k the scale, filling it: a slider takes the width the values
 * leave (at least 64 px), the values end at the right edge; values alone are spread, the first at the left edge, the
 * last ending at the right one. What does not fit is left out from the end. An item:
 * { kind: 'slider', value, min, max, text, green } a track from min to max (a mark at 0 when it is inside) and a knob
 * at the value with text in it, green when green is set; or { kind: 'value', label, text } a small label over its
 * value. */
function drawData(cv, x, y, w, items, k) {
    k = k || 1;
    const GAP = 10 * k, MIN_TW = 64 * k;
    const width = (it) => Math.max(cv.textWidth(it.text, 24 * k, { font: 'bold' }), cv.textWidth(it.label, 13 * k, { font: 'bold' }));
    const slider = (items || []).filter((it) => it.kind === 'slider')[0];
    let vals = (items || []).filter((it) => it.kind !== 'slider').map((it) => ({ it, w: width(it) }));
    const need = () => vals.reduce((a, v) => a + v.w, 0) + GAP * (slider ? vals.length : Math.max(0, vals.length - 1)) + (slider ? MIN_TW : 0);
    while (vals.length && need() > w) vals.pop();
    const value = (v, at) => {
        cv.text(v.it.label, at, y + 14 * k, 13 * k, DIM, { font: 'bold' });
        cv.text(v.it.text, at, y + 40 * k, 24 * k, WHITE, { font: 'bold' });
    };
    const sum = vals.reduce((a, v) => a + v.w, 0);
    if (slider) {
        if (MIN_TW > w) return;
        const tw = w - sum - GAP * vals.length, cy = y + ROW_H * k / 2, v = typeof slider.value === 'number' ? slider.value : null;
        const span = slider.max - slider.min, at0 = (val) => x + (Math.max(slider.min, Math.min(slider.max, val)) - slider.min) / span * tw;
        cv.fillRect(x, cy - 2 * k, tw, 4 * k, DIM);
        if (slider.min < 0 && slider.max > 0) cv.fillRect(at0(0) - 1 * k, cy - 8 * k, 2 * k, 16 * k, DIM);
        const text = v === null ? '-' : String(slider.text);
        const kw = Math.max(36 * k, cv.textWidth(text, 19 * k, { font: 'bold' }) + 14 * k);
        const kx = Math.max(x, Math.min(x + tw - kw, (v === null ? at0(Math.max(slider.min, Math.min(0, slider.max))) : at0(v)) - kw / 2));
        cv.roundRect(kx, cy - 12 * k, kw, 24 * k, 12 * k, slider.green ? GREEN : WHITE);
        cv.text(text, kx + kw / 2, cy + 7 * k, 19 * k, '#000000', { font: 'bold', align: 'center' });
        let at = x + tw + GAP;
        vals.forEach((it) => { value(it, at); at += it.w + GAP; });
        return;
    }
    const free = vals.length > 1 ? (w - sum) / (vals.length - 1) : 0;
    let at = x;
    vals.forEach((it) => { value(it, at); at += it.w + free; });
}

/* An arrow pointing left (dir -1) or right (dir 1), filling w x h. */
function drawArrow(cv, w, h, dir, color) {
    const head = Math.round(w * 0.62), shaft = Math.round(h * 0.42);
    const tip = dir < 0 ? 4 : w - 4, base = dir < 0 ? head : w - head, tail = dir < 0 ? w - 6 : 6;
    cv.quad([[tip, h / 2], [base, 4], [base, h - 4], [tip, h / 2]], color);
    const x0 = Math.min(base, tail), x1 = Math.max(base, tail);
    cv.fillRect(x0 - (dir < 0 ? 1 : 0), (h - shaft) / 2, x1 - x0 + 1, shaft, color);
}

function drawGear(cv, gear) {
    const g = String(gear || '');
    // one word, as BMW's own gear reading: P, R, N, D, D3; a longer one smaller to fit
    const size = cv.textWidth(g, 36, { font: 'gear' }) <= GEAR_W - 2 ? 36 : 28;
    // the capitals (0.7 of the size) centred in the row, as the arrows are
    cv.text(g, 2, Math.round((GEAR_H + 0.7 * size) / 2), size, g.charAt(0) === 'R' ? AMBER : WHITE, { font: 'gear' });
}

class HudOverlay {
    constructor(opts) {
        const o = opts || {};
        this.log = o.log || { info() {}, warn() {} };
        this.cr = o.client || new ClusterRender('robertn_waze_cluster');
        this.layers = {};          // name -> { ref, w, h, key }
        this.want = null;
        this.target = { state: 'off', disabled: 0 };
        this.blinkOn = true;
        this.cr.on('target', (name, state, holder, reason, guideDisabled, disabled) => {
            if (name !== 'hud') return;
            this.target = { state, reason, disabled };
        });
        this.cr.on('ready', () => { Object.keys(this.layers).forEach((n) => { this.layers[n].key = null; }); this._draw(); });
        this.cr.on('error', (op, ref, reason) => this.log.warn('hud overlay: ' + op + ' refused: ' + reason));
        this.connected = false;
        this.timer = null;
        this._blink();
    }

    /* The blink, lit from now: (re)started as a turn signal comes on, so its first flash is a whole one. */
    _blink() {
        clearInterval(this.timer);
        this.blinkOn = true;
        this.timer = setInterval(() => {
            this.blinkOn = !this.blinkOn;
            if (this.want && (this.want.turn.left || this.want.turn.right)) this._draw();
        }, BLINK_MS);
    }

    /* What the HUD should show now (see the top of this file). */
    update(w) {
        const was = this.want && (this.want.turn.left || this.want.turn.right);
        this.want = Object.assign({ turn: {}, map: mapRect(0) }, w);
        if (!was && (this.want.turn.left || this.want.turn.right)) this._blink();
        const any = (this.want.showTurn && (this.want.turn.left || this.want.turn.right)) || (this.want.showGear && this.want.gear) ||
            (this.want.data && this.want.data.length) || typeof this.want.speed === 'number';
        if (any && !this.connected) { this.connected = true; this.cr.connect(); }
        this._draw();
    }

    state() {
        if (!this.connected) return 'off';
        if (this.target.disabled) return 'disabled';
        return this.target.state === 'shown' ? 'shown' : this.target.state === 'unavailable' ? 'unavailable' : 'waiting';
    }

    _layer(name, rect, draw, key) {
        let l = this.layers[name];
        if (l && (l.w !== rect.w || l.h !== rect.h)) { this.cr.drop(l.ref); l = null; }
        if (!l) {
            const ref = this.cr.image({ target: 'hud', klass: 'overlay', z: 10, x: rect.x, y: rect.y, w: rect.w, h: rect.h,
                iw: rect.w, ih: rect.h, fps: 25 });
            l = this.layers[name] = { ref, w: rect.w, h: rect.h, x: rect.x, y: rect.y, key: null };
        } else if (l.x !== rect.x || l.y !== rect.y) {
            this.cr.set(l.ref, { x: rect.x, y: rect.y });
            l.x = rect.x; l.y = rect.y;
        }
        if (l.key === key) return;
        l.key = key;
        const cv = new Canvas(rect.w, rect.h).clear([0, 0, 0, 0]);
        draw(cv);
        this.cr.pixels(l.ref, null, Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length));
    }

    _drop(name) {
        if (this.layers[name]) { this.cr.drop(this.layers[name].ref); delete this.layers[name]; }
    }

    _draw() {
        const w = this.want;
        if (!w || !this.connected) return;
        const [aw, ah] = ARROW[w.arrowSize] || ARROW.medium;
        ['left', 'right'].forEach((side) => {
            const name = 'arrow-' + side;
            if (!w.showTurn) { this._drop(name); return; }
            const lit = !!w.turn[side] && this.blinkOn;
            // made the first time its side is on; kept (blank) after, so a blink asks the HUD for nothing new
            if (!w.turn[side] && !this.layers[name]) return;
            const rect = arrowRect(w.map, side, aw, ah);
            this._layer(name, rect, (cv) => { if (lit) drawArrow(cv, rect.w, rect.h, side === 'left' ? -1 : 1, GREEN); }, (lit ? 'on' : 'off') + rect.w);
        });
        if (w.showGear && w.gear) {
            this._layer('gear', gearRect(w.map, w.arrowSize), (cv) => drawGear(cv, w.gear), 'g' + w.gear);
        } else {
            this._drop('gear');
        }
        if (typeof w.speed === 'number') {
            this._layer('speed', SPEED_RECT, (cv) => cv.text(String(w.speed), SPEED_RECT.w - 2, SPEED_RECT.h - 8, 40, WHITE,
                { font: 'bold', align: 'right' }), 's' + w.speed);
        } else {
            this._drop('speed');
        }
        const dr = w.data && w.data.length ? dataRect(w.map, w.arrowSize) : null;
        if (dr) {
            this._layer('data', dr, (cv) => drawData(cv, 0, 0, dr.w, w.data), JSON.stringify(w.data));
        } else {
            this._drop('data');
        }
    }

    close() {
        clearInterval(this.timer);
        Object.keys(this.layers).forEach((n) => this._drop(n));
        if (this.connected) this.cr.close();
        this.connected = false;
    }
}

module.exports = { HudOverlay, mapRect, anchorRect, rowRect, gearRect, arrowRect, dataRect, drawArrow, drawGear, drawData, HUD_W, HUD_H, ARROW, GEAR_W, GEAR_H,
    ROW_H, SPEED_END, SPEED_RECT, MAX_KW, GREEN, WHITE, AMBER, DIM };
