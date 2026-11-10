// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * hud_overlay - the turn signals and the gear on the HUD, as image layers of the cluster renderer
 * (cluster_render_client.js, target `hud`, 800 x 480), over BMW's own HUD content and the map:
 *
 *   left arrow           left of BMW's speed-limit sign, at the HUD's left edge (LEFT_ARROW), blinking (BLINK_MS on,
 *                        BLINK_MS off, lit first) while that turn signal is on
 *   real speed           left of BMW's own speed reading, in its row (SPEED_RECT, where the HUD has room for its
 *                        digits): the car's own speed, for a car whose mileage blocker stops BMW's
 *   gear                 under BMW's km/h (GEAR_RECT), as small as it: P, R, N, D or D1 ... D9
 *   data                 level with the turn signals, from after BMW's km/h (DATA_X) to the right arrow: up
 *                        to three readings chosen, in their order: the electric range with the eDrive power, battery
 *                        charge, oil and coolant, boost, power and torque, engine speed (sliders carry their value in
 *                        the knob)
 *   right arrow          at the HUD's right edge (RIGHT_END), level with the left one
 *
 * The HUD shows black as nothing: each layer is drawn on transparent pixels and only what is lit shows.
 * A layer stays visible once made and an arrow that is off is sent as blank pixels, so the HUD's slot is not
 * asked for and given back on every blink. Nothing is made while the overlay has nothing to show.
 *
 *   const hud = new HudOverlay({ log });
 *   hud.update({ turn: { left, right }, gear: 'D3', map: { x, y, w, h }, arrowSize: 'medium', showTurn: true, showGear: true,
 *                data: [{ kind: 'slider', value, min, max, text }, { kind: 'value', label: 'OIL', text: '92°' }, ...], speed: 87 });
 *   hud.go(onHud, onCluster)   a traffic light with its green lit (green_light.js) at the top of the map's place on the HUD and in the middle of the
 *                    cluster (target `map`, 1088 x 480), as alerts over the rest, until go(false, false)
 *   hud.panel(items)  the cluster's info bar (cluster_panel.js) in the middle of the cluster, low (target `map`); null: none
 *   hud.dim(f)       the HUD's layers at f of their brightness (night: less), 1 by day
 *   hud.state()      -> 'off' | 'waiting' | 'shown' | 'disabled' | 'unavailable' (the HUD target, as the renderer says)
 *   hud.close();
 */
const { ClusterRender } = require('./cluster_render_client.js');
const PANEL = require('./cluster_panel.js');
const { Canvas, withAlpha } = require('./kit/canvas');

const HUD_W = 800, HUD_H = 480;
/* BMW's own indicator's pace: about 1.5 flashes a second */
const BLINK_MS = 330;
/* The arrow, one size, its tail short: the space it leaves goes to the data */
const ARROW = { medium: [34, 26] };
const ROW_H = 46;
/* The edges of what the HUD's glass shows in that row (from a photo of a G21's, its corner marks): the left arrow
 * left of BMW's speed-limit sign, the right arrow's end. */
const LEFT_ARROW_X = 120, RIGHT_END = 690;
/* Where the data starts: right after BMW's km/h (a photo of a G21's HUD: it ends at x 345). */
const DATA_X = 346;
/* The gear under BMW's km/h, down to the glass's bottom edge. */
const GEAR_RECT = { x: 304, y: 352, w: 56, h: 26 };
const GEAR_W = GEAR_RECT.w, GEAR_H = GEAR_RECT.h;
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

/* Where an arrow of aw x ah goes, both in BMW's speed row: the left one at the HUD's left edge (beside its
 * speed-limit sign), the right one at the HUD's right edge. */
function arrowRect(map, side, aw, ah) {
    const k = Math.min(1, (ROW_H - 8) / ah);
    const w = Math.round(aw * k), h = Math.round(ah * k);
    const y = SPEED_RECT.y + Math.round((SPEED_RECT.h - h) / 2);
    return { x: side === 'right' ? RIGHT_END - w : LEFT_ARROW_X, y, w, h };
}

/* The gear, under BMW's km/h. */
function gearRect() {
    return Object.assign({}, GEAR_RECT);
}

/* The data, from after BMW's km/h to the right arrow, level with the turn signals; null when there is no room. */
function dataRect(map, arrowSize) {
    const [aw, ah] = ARROW[arrowSize] || ARROW.medium, r = arrowRect(map, 'right', aw, ah);
    const x = DATA_X, w = r.x - 6 - x;
    return w >= 40 ? { x, y: SPEED_RECT.y + Math.round((SPEED_RECT.h - ROW_H) / 2), w, h: ROW_H } : null;
}

/* The data items across x, y (the row's top) to x + w, k the scale, filling it, in their order, their text as large
 * as fits (20 to 28 px): the sliders share the width the values leave (each at least 40 px); values alone are spread, the first at the left edge, the last
 * ending at the right one. What does not fit is left out from the end. An item:
 * { kind: 'slider', value, min, max, text, green, color } a track from min to max (a mark at 0 when it is inside) and
 * a knob at the value with text in it, green when green is set, the track lit in color from zero; or
 * { kind: 'value', label, text } a small label over its value. */
function drawData(cv, x, y, w, items, k) {
    k = k || 1;
    // the largest text all of them fit at (one reading alone: big), else the smallest with what does not fit left out
    const SIZES = [[28, 14], [26, 14], [24, 13], [22, 12], [20, 12]];
    const GAP = 6 * k, MIN_TW = 40 * k;
    const fit = (size) => {
        const width = (it) => (it.kind === 'slider' ? 0 : Math.max(cv.textWidth(it.text, size[0] * k, { font: 'bold' }), cv.textWidth(it.label, size[1] * k, { font: 'bold' })));
        const all = (items || []).map((it) => ({ it, w: width(it) }));
        const need = () => all.reduce((a, v) => a + (v.it.kind === 'slider' ? MIN_TW : v.w), 0) + GAP * Math.max(0, all.length - 1);
        return { all, need };
    };
    let size = SIZES.find((sz) => fit(sz).need() <= w) || SIZES[SIZES.length - 1];
    const { all, need } = fit(size);
    while (all.length && need() > w) all.pop();
    if (!all.length) return;
    const sliders = all.filter((v) => v.it.kind === 'slider').length;
    const sum = all.reduce((a, v) => a + v.w, 0);
    if (sliders) {
        const tw = (w - sum - GAP * (all.length - 1)) / sliders;
        let at = x;
        all.forEach((v) => {
            if (v.it.kind === 'slider') { drawSlider(cv, at, y + ROW_H * k / 2, tw, v.it, k); at += tw + GAP; } else { drawValue(cv, at, y, v.it, k, size); at += v.w + GAP; }
        });
        return;
    }
    const free = all.length > 1 ? (w - sum) / (all.length - 1) : 0;
    let at = x;
    all.forEach((v) => { drawValue(cv, at, y, v.it, k, size); at += v.w + free; });
}

function drawValue(cv, at, y, it, k, size) {
    cv.text(it.label, at, y + size[1] * k, size[1] * k, DIM, { font: 'bold' });
    cv.text(it.text, at, y + (ROW_H - 6) * k, size[0] * k, WHITE, { font: 'bold' });
}

function drawSlider(cv, x, cy, tw, slider, k) {
    const v = typeof slider.value === 'number' ? slider.value : null;
    const span = slider.max - slider.min, at0 = (val) => x + (Math.max(slider.min, Math.min(slider.max, val)) - slider.min) / span * tw;
    cv.fillRect(x, cy - 2 * k, tw, 4 * k, DIM);
    // a coloured slider (the battery's power): the track lit from zero to the value in its colour
    if (slider.color && v !== null) {
        const a = at0(Math.max(slider.min, Math.min(0, slider.max))), b = at0(v);
        cv.fillRect(Math.min(a, b), cy - 2 * k, Math.abs(b - a), 4 * k, slider.color);
    }
    if (slider.min < 0 && slider.max > 0) cv.fillRect(at0(0) - 1 * k, cy - 8 * k, 2 * k, 16 * k, DIM);
    const text = v === null ? '-' : String(slider.text);
    const kw = Math.max(36 * k, cv.textWidth(text, 19 * k, { font: 'bold' }) + 14 * k);
    const kx = Math.max(x, Math.min(x + tw - kw, (v === null ? at0(Math.max(slider.min, Math.min(0, slider.max))) : at0(v)) - kw / 2));
    cv.roundRect(kx, cy - 12 * k, kw, 24 * k, 12 * k, slider.color || (slider.green ? GREEN : WHITE));
    cv.text(text, kx + kw / 2, cy + 7 * k, 19 * k, '#000000', { font: 'bold', align: 'center' });
}

/* An arrow pointing left (dir -1) or right (dir 1), filling w x h. */
function drawArrow(cv, w, h, dir, color) {
    const head = Math.round(w * 0.62), shaft = Math.round(h * 0.42);
    const tip = dir < 0 ? 4 : w - 4, base = dir < 0 ? head : w - head, tail = dir < 0 ? w - 6 : 6;
    cv.quad([[tip, h / 2], [base, 4], [base, h - 4], [tip, h / 2]], color);
    const x0 = Math.min(base, tail), x1 = Math.max(base, tail);
    cv.fillRect(x0 - (dir < 0 ? 1 : 0), (h - shaft) / 2, x1 - x0 + 1, shaft, color);
}

/* A traffic light, its green lit: on w x h (taller than wide), red and yellow faint, green bright with a glow. */
function drawLight(cv, w, h) {
    const r = Math.min(w * 0.36, h * 0.13), cx = w / 2, gap = (h - 6 * r) / 4;
    cv.roundRect(cx - r * 1.45, 0, r * 2.9, h, r * 0.9, '#1a1d22');
    cv.strokeRoundRect(cx - r * 1.45, 1, r * 2.9, h - 2, r * 0.9, 2, '#5c636b');
    const y = (i) => gap + r + i * (2 * r + gap);
    cv.circle(cx, y(0), r, '#4a1414');
    cv.circle(cx, y(1), r, '#4a3e10');
    cv.circle(cx, y(2), r * 1.12, withAlpha(GREEN, 0.35));
    cv.circle(cx, y(2), r, GREEN);
}
const LIGHT_HUD = { w: 44, h: 112 };
const LIGHT_CLUSTER = { x: 516, y: 24, w: 56, h: 150 };     // small, at the top of the cluster's middle

/* The gear on cv from x, y (0, 0: its layer), k the scale, alpha its brightness (a preview's faint one). */
function drawGear(cv, gear, o) {
    const p = o || {}, k = p.k || 1, x = p.x || 0, y = p.y || 0;
    const col = (c) => (p.alpha === undefined ? c : withAlpha(c, p.alpha));
    const g = String(gear || ''), size = 24 * k, gap = 3 * k;
    // as small as BMW's km/h over it, the letters spread wider; R in amber
    let at = x + 1 * k;
    for (const ch of g) {
        cv.text(ch, at, y + Math.round((GEAR_H * k + 0.7 * size) / 2), size, col(g.charAt(0) === 'R' ? AMBER : WHITE), { font: 'gear' });
        at += cv.textWidth(ch, size, { font: 'gear' }) + gap;
    }
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
        this.goWant = { hud: false, cluster: false };
        this.panelItems = null;
        this.opacity = 1;
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

    panel(items) {
        this.panelItems = items && items.length ? items : null;
        if (this.panelItems && !this.connected) { this.connected = true; this.cr.connect(); }
        this._draw();
    }

    dim(f) {
        if (f === this.opacity) return;
        this.opacity = f;
        Object.keys(this.layers).forEach((n) => { if (this.layers[n].target === 'hud') this.cr.set(this.layers[n].ref, { opacity: f }); });
    }

    go(onHud, onCluster) {
        this.goWant = { hud: !!onHud, cluster: !!onCluster };
        if ((onHud || onCluster) && !this.connected) { this.connected = true; this.cr.connect(); }
        this._draw();
    }

    state() {
        if (!this.connected) return 'off';
        if (this.target.disabled) return 'disabled';
        return this.target.state === 'shown' ? 'shown' : this.target.state === 'unavailable' ? 'unavailable' : 'waiting';
    }

    _layer(name, rect, draw, key, where) {
        let l = this.layers[name];
        if (l && (l.w !== rect.w || l.h !== rect.h)) { this.cr.drop(l.ref); l = null; }
        if (!l) {
            const at = where || { target: 'hud', klass: 'overlay', z: 10 };
            const ref = this.cr.image({ target: at.target, klass: at.klass, z: at.z, x: rect.x, y: rect.y, w: rect.w, h: rect.h,
                iw: rect.w, ih: rect.h, fps: 25, opacity: at.target === 'hud' ? this.opacity : 1 });
            l = this.layers[name] = { ref, w: rect.w, h: rect.h, x: rect.x, y: rect.y, key: null, target: at.target };
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
        if (!this.connected) return;
        if (this.panelItems) {
            const pr = PANEL.panelRect(this.panelItems);
            this._layer('panel', pr, (cv) => PANEL.drawPanel(cv, 0, 0, this.panelItems), JSON.stringify(this.panelItems), { target: 'map', klass: 'overlay', z: 12 });
        } else this._drop('panel');
        const g = this.goWant;
        if (g.cluster) this._layer('go-cluster', LIGHT_CLUSTER, (cv) => drawLight(cv, LIGHT_CLUSTER.w, LIGHT_CLUSTER.h), 'go', { target: 'map', klass: 'alert', z: 20 });
        else this._drop('go-cluster');
        const w = this.want;
        if (g.hud) {
            const a = anchorRect((w && w.map) || mapRect(0));
            const rect = { x: Math.round(a.x + (a.w - LIGHT_HUD.w) / 2), y: a.y + 4, w: LIGHT_HUD.w, h: LIGHT_HUD.h };
            this._layer('go-hud', rect, (cv) => drawLight(cv, LIGHT_HUD.w, LIGHT_HUD.h), 'go', { target: 'hud', klass: 'alert', z: 20 });
        } else this._drop('go-hud');
        if (!w) return;
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

module.exports = { HudOverlay, drawLight, LIGHT_HUD, LIGHT_CLUSTER, mapRect, anchorRect, rowRect, gearRect, arrowRect, dataRect, drawArrow, drawGear, drawData, HUD_W, HUD_H, ARROW, GEAR_W, GEAR_H,
    GEAR_RECT, LEFT_ARROW_X, RIGHT_END, DATA_X, ROW_H, SPEED_RECT, MAX_KW, GREEN, WHITE, AMBER, DIM };
