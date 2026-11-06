// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * hud_overlay - the turn signals and the gear on the HUD, as image layers of the cluster renderer
 * (cluster_render_client.js, target `hud`, 800 x 480), over BMW's own HUD content and the map:
 *
 *   one row under the map (inside its bottom edge when the HUD has no room under it), within its sides:
 *   left arrow           after BMW's own speed reading (SPEED_END), blinking (BLINK_MS on, BLINK_MS off) while
 *                        that turn signal is on
 *   gear                 beside the left arrow: P, R, N, D or D1 ... D9
 *   data                 between the gear and the right arrow, the one reading chosen: the electric range with the
 *                        eDrive power (a slider with its kW), or oil and coolant temperatures
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
 *                data: [{ kind: 'power', kw }, { kind: 'value', label: 'OIL', text: '92°' }, ...], speed: 87 });
 *   hud.state()      -> 'off' | 'waiting' | 'shown' | 'disabled' | 'unavailable' (the HUD target, as the renderer says)
 *   hud.close();
 */
const { ClusterRender } = require('./cluster_render_client.js');
const { Canvas } = require('./kit/canvas');

const HUD_W = 800, HUD_H = 480;
const BLINK_MS = 400;
const ARROW = { small: [40, 26], medium: [52, 34], large: [66, 44] };
const ROW_H = 46;
const GEAR_W = 44, GEAR_H = ROW_H;          // D1 ... D9 at 40 px are 40 wide
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

/* The row under the map; inside its bottom edge when the HUD has no room under it. */
function rowRect(map) {
    const below = map.y + map.h + 6;
    return { x: map.x, y: below + ROW_H <= HUD_H ? below : Math.max(0, map.y + map.h - ROW_H - 4), w: map.w, h: ROW_H };
}

/* Where an arrow of aw x ah goes in the row: the left one after BMW's speed reading (short of the map's middle), the
 * right one at the map's right edge. */
function arrowRect(map, side, aw, ah) {
    const row = rowRect(map), k = Math.min(1, (ROW_H - 8) / ah);
    const w = Math.round(aw * k), h = Math.round(ah * k), y = row.y + Math.round((ROW_H - h) / 2);
    if (side === 'right') return { x: map.x + map.w - w - 4, y, w, h };
    return { x: Math.round(Math.max(map.x + 4, Math.min(SPEED_END, map.x + map.w * 0.55 - w))), y, w, h };
}

/* The gear, beside the left arrow. */
function gearRect(map, arrowSize) {
    const [aw, ah] = ARROW[arrowSize] || ARROW.medium, a = arrowRect(map, 'left', aw, ah);
    return { x: a.x + a.w + 6, y: rowRect(map).y, w: GEAR_W, h: GEAR_H };
}

/* The data, between the gear and the right arrow; null when there is no room. */
function dataRect(map, arrowSize) {
    const [aw, ah] = ARROW[arrowSize] || ARROW.medium, g = gearRect(map, arrowSize), r = arrowRect(map, 'right', aw, ah);
    const x = g.x + g.w + 12, w = r.x - 8 - x;
    return w >= 40 ? { x, y: g.y, w, h: ROW_H } : null;
}

/* The data items across x, y (the row's top) to x + w, k the scale, filling it: the eDrive slider takes the width
 * the values leave (at least 64 px), the values end at the right edge; values alone are spread, the first at the
 * left edge, the last ending at the right one. What does not fit is left out from the end. An item:
 * { kind: 'power', kw } a slider centred on 0 (- regen and charging, green; + driving on the battery) with its kW,
 * or { kind: 'value', label, text } a small label over its value. */
function drawData(cv, x, y, w, items, k) {
    k = k || 1;
    const GAP = 10 * k, MIN_TW = 64 * k;
    const width = (it) => Math.max(cv.textWidth(it.text, 24 * k, { font: 'bold' }), cv.textWidth(it.label, 13 * k, { font: 'bold' }));
    const power = (items || []).filter((it) => it.kind === 'power')[0];
    let vals = (items || []).filter((it) => it.kind !== 'power').map((it) => ({ it, w: width(it) }));
    const need = () => vals.reduce((a, v) => a + v.w, 0) + GAP * (power ? vals.length : Math.max(0, vals.length - 1)) + (power ? MIN_TW : 0);
    while (vals.length && need() > w) vals.pop();
    const value = (v, at) => {
        cv.text(v.it.label, at, y + 14 * k, 13 * k, DIM, { font: 'bold' });
        cv.text(v.it.text, at, y + 40 * k, 24 * k, WHITE, { font: 'bold' });
    };
    const sum = vals.reduce((a, v) => a + v.w, 0);
    if (power) {
        if (MIN_TW > w) return;
        const tw = w - sum - GAP * vals.length;
        const mid = x + tw / 2, cy = y + ROW_H * k / 2, kw = typeof power.kw === 'number' ? power.kw : null;
        cv.fillRect(x, cy - 2 * k, tw, 4 * k, DIM);
        cv.fillRect(mid - 1 * k, cy - 8 * k, 2 * k, 16 * k, DIM);
        const f = kw === null ? 0 : Math.max(-1, Math.min(1, kw / MAX_KW));
        const kx = Math.max(x, Math.min(x + tw - 36 * k, mid + f * (tw / 2) - 18 * k));
        cv.roundRect(kx, cy - 12 * k, 36 * k, 24 * k, 12 * k, kw !== null && kw < 0 ? GREEN : WHITE);
        cv.text(kw === null ? '-' : String(Math.round(Math.abs(kw))), kx + 18 * k, cy + 7 * k, 19 * k, '#000000', { font: 'bold', align: 'center' });
        let at = x + tw + GAP;
        vals.forEach((v) => { value(v, at); at += v.w + GAP; });
        return;
    }
    const free = vals.length > 1 ? (w - sum) / (vals.length - 1) : 0;
    let at = x;
    vals.forEach((v) => { value(v, at); at += v.w + free; });
}

/* An arrow pointing left (dir -1) or right (dir 1), filling w x h. */
function drawArrow(cv, w, h, dir, color) {
    const head = Math.round(w * 0.48), shaft = Math.round(h * 0.42);
    const tip = dir < 0 ? 4 : w - 4, base = dir < 0 ? head : w - head, tail = dir < 0 ? w - 6 : 6;
    cv.quad([[tip, h / 2], [base, 4], [base, h - 4], [tip, h / 2]], color);
    const x0 = Math.min(base, tail), x1 = Math.max(base, tail);
    cv.fillRect(x0 - (dir < 0 ? 1 : 0), (h - shaft) / 2, x1 - x0 + 1, shaft, color);
}

function drawGear(cv, gear) {
    const g = String(gear || '');
    // one word, as BMW's own gear reading: P, R, N, D, D3; a longer one smaller to fit
    const size = cv.textWidth(g, 40, { font: 'gear' }) <= GEAR_W - 2 ? 40 : 32;
    cv.text(g, 2, GEAR_H - 8, size, g.charAt(0) === 'R' ? AMBER : WHITE, { font: 'gear' });
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
        this.timer = setInterval(() => {
            this.blinkOn = !this.blinkOn;
            if (this.want && (this.want.turn.left || this.want.turn.right)) this._draw();
        }, BLINK_MS);
    }

    /* What the HUD should show now (see the top of this file). */
    update(w) {
        this.want = Object.assign({ turn: {}, map: mapRect(0) }, w);
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
                iw: rect.w, ih: rect.h, fps: 10 });
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

module.exports = { HudOverlay, mapRect, rowRect, gearRect, arrowRect, dataRect, drawArrow, drawGear, drawData, HUD_W, HUD_H, ARROW, GEAR_W, GEAR_H,
    ROW_H, SPEED_END, SPEED_RECT, MAX_KW, GREEN, WHITE, AMBER, DIM };
