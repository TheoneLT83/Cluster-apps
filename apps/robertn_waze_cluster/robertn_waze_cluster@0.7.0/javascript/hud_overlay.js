// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * hud_overlay - the turn signals and the gear on the HUD, as image layers of the cluster renderer
 * (cluster_render_client.js, target `hud`, 800 x 480), over BMW's own HUD content and the map:
 *
 *   left / right arrow   over the map's top-left and top-right corners (just above the map where the HUD has room,
 *                        else inside its top edge), never past its sides; blinking (BLINK_MS on, BLINK_MS off)
 *                        while that turn signal is on
 *   gear                 under the map, at its right side (inside its bottom edge when the HUD has no room
 *                        under it): P, R, N, D or D1 ... D9
 *
 * The HUD shows black as nothing: each layer is drawn on transparent pixels and only what is lit shows.
 * A layer stays visible once made and an arrow that is off is sent as blank pixels, so the HUD's slot is not
 * asked for and given back on every blink. Nothing is made while the overlay has nothing to show.
 *
 *   const hud = new HudOverlay({ log });
 *   hud.update({ turn: { left, right }, gear: 'D3', map: { x, y, w, h }, arrowSize: 'medium', showTurn: true, showGear: true });
 *   hud.state()      -> 'off' | 'waiting' | 'shown' | 'disabled' | 'unavailable' (the HUD target, as the renderer says)
 *   hud.close();
 */
const { ClusterRender } = require('./cluster_render_client.js');
const { Canvas } = require('./kit/canvas');

const HUD_W = 800, HUD_H = 480;
const BLINK_MS = 400;
const ARROW = { small: [40, 26], medium: [52, 34], large: [66, 44] };
const GEAR_W = 84, GEAR_H = 52;
const GREEN = '#25e05a', WHITE = '#f2f5f8', AMBER = '#ffb020';

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

/* Where the gear goes: under the map, at its right side; inside its bottom edge when the HUD has no room under it. */
function gearRect(map) {
    const below = map.y + map.h + 4;
    return { x: Math.max(0, map.x + map.w - GEAR_W), y: below + GEAR_H <= HUD_H ? below : Math.max(0, map.y + map.h - GEAR_H - 2), w: GEAR_W, h: GEAR_H };
}

/* Where an arrow of aw x ah goes: over the map's top corner on its side, just above the map where the HUD has
 * room, else inside the map's top edge; within the map's sides, smaller where the map is narrow. */
function arrowRect(map, side, aw, ah) {
    const k = Math.min(1, (map.w / 2 - 8) / aw);
    const w = Math.round(aw * k), h = Math.round(ah * k);
    const y = map.y - h - 8 >= 0 ? map.y - h - 8 : map.y + 6;
    return { x: side === 'left' ? map.x + 4 : map.x + map.w - w - 4, y, w, h };
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
    const size = cv.textWidth(g, 46, { font: 'gear' }) <= GEAR_W - 4 ? 46 : 38;
    cv.text(g, GEAR_W - 2, GEAR_H - 8, size, g.charAt(0) === 'R' ? AMBER : WHITE, { font: 'gear', align: 'right' });
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
        const any = (this.want.showTurn && (this.want.turn.left || this.want.turn.right)) || (this.want.showGear && this.want.gear);
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
            this._layer('gear', gearRect(w.map), (cv) => drawGear(cv, w.gear), 'g' + w.gear);
        } else {
            this._drop('gear');
        }
    }

    close() {
        clearInterval(this.timer);
        Object.keys(this.layers).forEach((n) => this._drop(n));
        if (this.connected) this.cr.close();
        this.connected = false;
    }
}

module.exports = { HudOverlay, mapRect, gearRect, arrowRect, drawArrow, drawGear, HUD_W, HUD_H, ARROW, GEAR_W, GEAR_H, GREEN, WHITE, AMBER };
