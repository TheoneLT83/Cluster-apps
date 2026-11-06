// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * Cluster functions: the phone's map on the instrument cluster and the HUD (waze-on-cluster), turn signals and
 * the gear on the HUD (hud_overlay.js), drawn by the Store's renderer with the idrive7-apps kit (kit/).
 *
 * background(bg): what runs from the platform's start (the app starts by itself, "mguAppStartType":
 * "autostart"), with its screen closed too: the waze-on-cluster clients, the gear, the turn signals, the HUD
 * overlay, the HMI's display language. start(ctx): the screen, its pages (the header's tabs):
 *   Maps      where the map shows (Cluster, HUD, both), its state, BMW's logo on the cluster; CarPlay or Android
 *             Auto: its patch (Patch, Reinstall patch over another tool's, Remove patch), Android Auto's zoom and turn
 *             card, CarPlay's Wi-Fi, Restart head unit while a change waits for it or after a patch; the HUD map's
 *             size, brightness and place, with a picture of the HUD
 *   Display   what the HUD shows under the map: the turn signals and the gear on or off, and between the
 *             turn signals none, the electric range with the eDrive power, oil and coolant, boost, power and torque
 *             (torque x rpm, in M Vitals' units where it has them), or engine speed; with a picture of it
 *   Log       the app's log, and the saved logs for a phone on the car's hotspot
 *   Settings  the kit's settings sheet: Displays on HUD (off: nothing of this app on the HUD), Real speed on HUD (left of BMW's own speed), the arrows' size, the colours, the
 *             layout
 * Every word is in the HMI's display language (i18n.js), English where a language has none, with the glyphs of
 * fonts/ (tools/bake_fonts.py). Arabic, Hebrew and Thai are drawn in English: the kit draws no shaping or
 * right-to-left; their words show on the tile and the HMI's own screens.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const Car = require('./kit/car');
const { withAlpha } = require('./kit/canvas');
const fonts = require('./kit/fonts');
const i18n = require('./i18n.js');
const { WazeClusterControl, HUD_SIZE_STEPS, ZOOM_STEP } = require('./waze_cluster_control.js');
const { LogsControl } = require('./logs_control.js');
const path = require('path');
const { HudOverlay, mapRect, gearRect, arrowRect, dataRect, drawArrow, drawData, HUD_W, HUD_H, ARROW, GREEN, SPEED_RECT } = require('./hud_overlay.js');
const { HvData } = require('./hv_data.js');
const { Units } = require('./units.js');
const { TurnSignals } = require('./turn_signals.js');
const qrcodegen = require('./qrcodegen.js');

const { t } = i18n;
const W = 1600, H = 520;
const PAGES = ['Maps', 'Display', 'Log'];
/* The Display page's switches: the setting, its words. */
const HUD_ITEMS = [['hudTurn', 'Turn signals'], ['hudGear', 'Gear']];
/* What shows between the turn signals (the setting hudData), one at a time. */
const HUD_DATA = [['off', 'None'], ['ev', 'Electric range'], ['temps', 'Oil and coolant'], ['boost', 'Boost'], ['power', 'Power and torque'],
    ['rpm', 'Engine speed']];
const RPM_MAX = 7000;
const LOG_LINES = 60;
const HMI_CONTEXT = ['de.bmw.infotainment.hmi.hmicontext.HMIContext', 'HMI_CID'];
/* The HUD overlay's state, by hud.state(), for the log. */
const HUD_STATES = { off: 'nothing to show', waiting: 'waiting for the HUD', shown: 'shown', disabled: 'off after errors', unavailable: 'no HUD' };
/* The display languages drawn in English. */
const DRAWN_ENGLISH = ['ar', 'he', 'th'];

/* The app's glyph atlases (fonts/woc-*.json) for the language in use: its Chinese or Japanese, its Latin. */
function useFonts(code) {
    fonts.useScripts({ latin: code === 'vi' ? 'woc-vietnamese' : 'woc-latin', greek: 'woc-greek', cyrillic: 'woc-cyrillic',
        korean: 'woc-korean', cjk: code === 'ja' ? 'woc-japanese' : code === 'zh-TW' ? 'woc-cjk-tc' : 'woc-cjk-sc' });
}

/* The signal catalog's errors, by turn_signals.js's find(), for the log. */
const CATALOG_ERRORS = { absent: 'No signal catalog on this unit', unreadable: 'The signal catalog cannot be read' };

/* P / R / N / D, D1 ... D9 from car.js's data: its gear (-1 R, 0 N/P, 1...) and the selector stage. */
function gearText(d) {
    if (!d) return null;
    if (d.stage === 'D') return G.isNum(d.gear) && d.gear > 0 ? 'D' + d.gear : 'D';
    if (d.stage) return d.stage;
    if (!G.isNum(d.gear)) return null;
    return d.gear < 0 ? 'R' : d.gear === 0 ? 'N' : 'D' + d.gear;
}

function fit(cv, s, size, w, font) {
    s = String(s);
    if (cv.textWidth(s, size, { font }) <= w) return s;
    while (s.length > 1 && cv.textWidth(s + '...', size, { font }) > w) s = s.slice(0, -1);
    return s + '...';
}

/* The settings' labels and choices in the display language: the English ones kept, the schema's translated. */
function translateSettings(settings) {
    (settings.schema || []).forEach((s) => {
        s._en = s._en || { label: s.label, options: (s.options || []).map((o) => o[1]) };
        s.label = t(s._en.label);
        (s.options || []).forEach((o, i) => { o[1] = t(s._en.options[i]); });
    });
}

/* ---- in the background: from the platform's start, with or without the screen ---- */
async function background(bg) {
    const { settings } = bg;
    // the app's log, also kept for the Log page
    const lines = [];
    const keep = (lvl) => (...a) => {
        const s = a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
        lines.push(new Date().toTimeString().slice(0, 8) + ' ' + (lvl === 'info' ? '' : lvl.toUpperCase() + ' ') + s);
        if (lines.length > LOG_LINES) lines.shift();
        return bg.log[lvl](...a);
    };
    const log = { info: keep('info'), warn: keep('warn'), error: keep('error') };
    const listeners = [];
    const changed = () => listeners.forEach((fn) => fn());

    const ctl = new WazeClusterControl({ log });
    const logs = new LogsControl({ log });
    const turns = new TurnSignals();
    const hud = new HudOverlay({ log });
    // boost from the sport display (FES), as M Vitals reads it: bar, 0.01 a step, 255 no value
    let boost = null;
    const car = new Car(Object.assign({}, bg, { log }), ['gear', 'speed', 'rpm', 'temps', 'torque'], {
        'de.bmw.infotainment.drivingexcitement.FES': {
            statusSwitchDriveDynamicSport2: (v) => { const r = v && v.displayBoostPressure; boost = G.isNum(r) && r !== 255 ? r * 0.01 : null; },
        },
    });
    const units = new Units({ settings, appRoot: bg.dataDir && path.dirname(bg.dataDir), log });
    const dataChoice = () => settings.get('hudData');
    const hv = new HvData({ signals: bg.signals, log, file: bg.dataDir && path.join(bg.dataDir, 'hv.json') });
    // the battery unit is read only while its power or the range is shown
    const hvWanted = () => { if (settings.get('hudOn') !== false && dataChoice() === 'ev') hv.start(); else hv.stop(); };
    const mapNow = () => mapRect(ctl.hudWidth() || 0, ctl.hudOffset() || [0, 0]);
    // the HUD shows the car's gear only, never demo data
    const gearNow = () => { const d = car.data(); return d && !d.demo ? gearText(d) : null; };
    /* The data under the map (hud_overlay.js drawData), the car's own only; preview: every chosen one, '--' for
     * a value not known. */
    const dataNow = (preview) => {
        const d = car.data(), real = d && !d.demo ? d : {}, out = [];
        const value = (label, v, unit) => { if (G.isNum(v) || preview) out.push({ kind: 'value', label, text: G.isNum(v) ? Math.round(v) + unit : '--' }); };
        const c = dataChoice();
        const slider = (v, min, max, text, green) => { if (G.isNum(v) || preview) out.push({ kind: 'slider', value: G.isNum(v) ? v : null, min, max, text, green }); };
        if (c === 'ev') {
            const kw = hv.power();
            slider(kw, -60, 60, G.isNum(kw) ? Math.round(Math.abs(kw)) : '', G.isNum(kw) && kw < 0);
            value(t('EV'), hv.range(), ' km');
        } else if (c === 'boost') {
            const b = units.boost(G.isNum(boost) && !(d && d.demo) ? boost : NaN);
            slider(b.value, 0, b.max, G.isNum(b.value) ? (b.unit === 'bar' ? b.value.toFixed(1) : Math.round(b.value)) + ' ' + b.unit : '');
        } else if (c === 'power') {
            const nm = real.torque, rpm = real.rpm, p = units.power(G.isNum(nm) && G.isNum(rpm) ? nm * rpm / 9549 : NaN), q = units.torque(G.isNum(nm) ? nm : NaN);
            value(t('POWER'), p.value, ' ' + p.unit);
            value(t('TORQUE'), q.value, ' ' + q.unit);
        } else if (c === 'rpm') {
            slider(real.rpm, 0, RPM_MAX, G.isNum(real.rpm) ? Math.round(real.rpm / 10) * 10 : '');
        } else if (c === 'temps') {
            value(t('OIL'), real.oil, '°');
            value(t('COOLANT'), real.coolant, '°');
        }
        return out;
    };
    // the car's own speed (a mileage blocker leaves it alone), with the setting realSpeed
    const speedNow = () => { const d = car.data(); return settings.get('realSpeed') && d && !d.demo && G.isNum(d.speed) ? Math.round(d.speed) : null; };
    // Displays on HUD off: nothing of ours on the HUD, which the renderer then gives back to BMW's own layout
    const toHud = () => (settings.get('hudOn') === false ? hud.update({ turn: {}, gear: null, map: mapNow(), showTurn: false, showGear: false,
        data: [], speed: null }) : hud.update({
        turn: turns.state(), gear: gearNow(), map: mapNow(), arrowSize: settings.get('arrowSize'),
        showTurn: !!settings.get('hudTurn'), showGear: !!settings.get('hudGear'), data: dataNow(false), speed: speedNow(),
    }));
    car.onSample(() => { hv.feed(car.data().demo ? null : car.data()); toHud(); changed(); });
    hv.on('change', () => { toHud(); changed(); });
    ctl.on('change', () => { toHud(); changed(); });
    logs.on('change', changed);
    turns.on('change', () => { toHud(); changed(); });
    settings.onChange(() => { hvWanted(); toHud(); changed(); });
    hvWanted();

    // the HMI's display language, at the start and on each change
    const language = (v) => {
        if (!i18n.setHmiLanguage(v)) return;
        if (DRAWN_ENGLISH.indexOf(i18n.language()) >= 0) {
            log.info('display language ' + v + ': drawn in English');
            i18n.setHmiLanguage(null);
        } else {
            log.info('display language ' + v + ': ' + i18n.language());
        }
        useFonts(i18n.language());
        translateSettings(settings);
        changed();
    };
    translateSettings(settings);
    useFonts(i18n.language());
    try {
        const { someipBuilders } = require('oap-sdk');
        let proxy;
        someipBuilders.buildTypedProxy(HMI_CONTEXT[0], HMI_CONTEXT[1])
            .then((p) => { proxy = p; return proxy.init(); })
            .then(() => proxy.waitUntilAvailable())
            .then(() => proxy.currentDisplayLanguage.subscribe(language))
            .then(() => proxy.currentDisplayLanguage.getValue())
            .then(language)
            .catch((e) => log.warn('display language unavailable: ' + (e && e.message)));
    } catch (e) { log.warn('display language unavailable: ' + e.message); }

    // what the Display page does not show: in the log when it changes
    let said = {};
    const say = (key, text) => { if (text && said[key] !== text) { said[key] = text; log.info(text); } };
    const sayStates = () => {
        say('hud', 'HUD overlay: ' + HUD_STATES[hud.state()]);
        const d = car.data();
        say('gear', d && d.demo ? 'demo: no gear from the car' : gearNow() ? 'gear from the car' : 'no gear from the car yet');
    };
    setInterval(sayStates, 2000);
    const f = turns.find();
    log.info(f.error ? CATALOG_ERRORS[f.error] || CATALOG_ERRORS.unreadable : f.fields.length ?
        'signal catalog: may carry the turn signals: ' + f.fields.map((it) => it.iface + '.' + it.field).join(', ') :
        'signal catalog: no field named for the turn signals');

    ctl.open();
    toHud();
    log.info('Cluster functions ' + bg.spec.version + ' started (' + (bg.app && bg.app.startReason) + ')');
    return { ctl, logs, turns, hud, car, lines, log, mapNow, gearNow, dataNow, onChange: (fn) => listeners.push(fn) };
}

mgu.run({
    background,

    async start(ctx) {
        const { ui, settings } = ctx;
        const b = ctx.background || await background(ctx);
        const { ctl, logs, turns, hud, car, lines, log, mapNow, gearNow, dataNow } = b;
        let page = 0, version = 0, drawn = -1, blink = true, phone = 'carplay';
        // the kit's header and Settings tab in the display language too
        const changed = () => {
            version++;
            ctx.display.settingsLabel = t('Settings');
            if (ctx.display.screen) ctx.display.screen.title = t('Cluster functions');
        };
        b.onChange(changed);
        setInterval(() => { blink = !blink; if (turns.state().test) changed(); }, 400);
        setInterval(changed, 1000);
        changed();

        /* ---- drawing helpers ---- */
        const label = (cv, th, s, x, y) => cv.text(String(s).toUpperCase(), x, y, 18, th.dim, { font: 'bold', spacing: 2 });
        const small = (cv, th, s, x, y, w, color) => { if (s) cv.text(fit(cv, s, 21, w, 'label'), x, y, 21, color || th.text, { font: 'label' }); };
        const line = (cv, th, s, x, y, w, color) => { if (s) cv.text(fit(cv, s, 24, w, 'label'), x, y, 24, color || th.text, { font: 'label' }); };
        const toggle = (cv, th, x, y, on, run, key, off) => {
            const S = th.sel || th.accent;
            cv.roundRect(x, y, 76, 38, 19, on ? withAlpha(S, off ? 0.4 : 1) : withAlpha('#ffffff', off ? 0.06 : 0.16));
            cv.circle(on ? x + 57 : x + 19, y + 19, 14, off ? withAlpha('#ffffff', 0.4) : '#ffffff');
            if (!off && cv.own) cv.target(x - 8, y - 6, 92, 50, run, key, 19);
        };
        // drawArrow at an offset: hud_overlay draws from 0,0
        const drawArrowAt = (cv, x, y, w, h, dir, c) => drawArrow({
            quad: (pts, col) => cv.quad(pts.map(([px, py]) => [x + px, y + py]), col),
            fillRect: (rx, ry, rw, rh, col) => cv.fillRect(x + rx, y + ry, rw, rh, col),
        }, w, h, dir, c);

        /* A picture of the HUD (HUD_W x HUD_H scaled into w): the map where waze-on-cluster puts it, the arrows
         * and the gear where the overlay draws them; lit as they are now. */
        const hudPicture = (cv, th, x, y, w) => {
            const k = w / HUD_W, h = HUD_H * k;
            cv.roundRect(x, y, w, h, 10, '#05070a');
            cv.strokeRoundRect(x, y, w, h, 10, 1.5, withAlpha('#ffffff', 0.25));
            const m = mapNow(), mx = x + m.x * k, my = y + m.y * k, mw = m.w * k, mh = m.h * k;
            const on = ctl.hudOn() === true, br = (ctl.hudBrightness() || 100) / 100;
            const a = (v) => (on ? v * (0.25 + 0.75 * br) : v * 0.25);
            cv.roundRect(mx, my, mw, mh, 8, withAlpha('#1c3a2c', a(1)));
            [[0.1, 0.25, 0.9, 0.35], [0.0, 0.7, 1.0, 0.62], [0.3, 0.0, 0.42, 1.0], [0.72, 0.0, 0.6, 1.0]].forEach(([x0, y0, x1, y1]) =>
                cv.line(mx + x0 * mw, my + y0 * mh, mx + x1 * mw, my + y1 * mh, 3, withAlpha('#7d8b92', a(0.9))));
            cv.polyline([[mx + 0.5 * mw, my + mh * 0.95], [mx + 0.5 * mw, my + mh * 0.55], [mx + 0.39 * mw, my + mh * 0.5],
                [mx + 0.36 * mw, my + mh * 0.1]], 6, withAlpha('#7ee05a', a(1)));
            cv.quad([[mx + 0.5 * mw, my + mh * 0.78], [mx + 0.47 * mw, my + mh * 0.9], [mx + 0.53 * mw, my + mh * 0.9], [mx + 0.5 * mw, my + mh * 0.78]],
                withAlpha('#ff4040', a(1)));
            const st = turns.state();
            if (settings.get('hudTurn')) {
                const [aw, ah] = ARROW[settings.get('arrowSize')] || ARROW.medium;
                ['left', 'right'].forEach((side) => {
                    const r = arrowRect(m, side, aw, ah);
                    drawArrowAt(cv, x + r.x * k, y + r.y * k, r.w * k, r.h * k, side === 'left' ? -1 : 1,
                        st[side] && blink ? GREEN : withAlpha(GREEN, 0.18));
                });
            }
            if (settings.get('hudGear')) {
                const g = gearRect(m, settings.get('arrowSize')), gt = gearText(car.data()) || 'D';
                cv.text(gt, x + (g.x + 2) * k, y + (g.y + g.h - 8) * k, 40 * k, gearNow() ? '#f2f5f8' : withAlpha('#f2f5f8', 0.35), { font: 'gear' });
            }
            if (settings.get('realSpeed')) {
                const sp = car.data() && !car.data().demo && G.isNum(car.data().speed) ? Math.round(car.data().speed) : null;
                cv.text(sp === null ? '--' : String(sp), x + (SPEED_RECT.x + SPEED_RECT.w) * k, y + (SPEED_RECT.y + SPEED_RECT.h - 8) * k, 40 * k,
                    sp === null ? withAlpha('#f2f5f8', 0.35) : '#f2f5f8', { font: 'bold', align: 'right' });
            }
            const dr = dataRect(m, settings.get('arrowSize'));
            if (dr) drawData(cv, x + dr.x * k, y + dr.y * k, dr.w * k, dataNow(true), k);
            return h;
        };

        /* ---- the pages ---- */
        function drawMaps(cv, th) {
            const ex = G.pageBottom(cv) - G.BOTTOM;
            G.panel(cv, th, 24, 44, 760, 468, t('Map'));
            label(cv, th, t('Show on'), 48, 120);
            const on = ctl.shownOn(), can = ctl.canChooseShownOn();
            let x = 48;
            [['cluster', 'Cluster'], ['hud', 'HUD'], ['both', 'Cluster + HUD']].forEach(([v, text]) => {
                x += G.button(cv, th, x, 130, 0, 44, t(text), () => ctl.showOn(v), { primary: on === v, busy: !can, key: 'show-' + v }) + 10;
            });
            small(cv, th, ctl.mapText(), 48, 204, 712);
            small(cv, th, ctl.hudText(), 48, 230, 712, ctl.hudDisabled() ? th.warn : null);
            const gu = ctl.guidanceUnavailable(), hide = ctl.hideGuidance();
            cv.text(fit(cv, t('Hide BMW logo on cluster'), 22, 600, 'label'), 48, 276, 22, gu ? th.dim : th.text, { font: 'label' });
            toggle(cv, th, 684, 252, !!hide, () => ctl.toggleGuidance(), 'guide', gu || hide === null);

            // the phone: CarPlay or Android Auto, its patch and its own settings
            cv.fillRect(48, 300 + ex / 4, 712, 1, withAlpha('#ffffff', 0.12));
            const py = 312 + ex / 4;
            x = 48;
            [['carplay', 'CarPlay'], ['aa', 'Android Auto']].forEach(([v, name]) => {
                x += G.button(cv, th, x, py, 0, 42, name, () => { phone = v; changed(); }, { primary: phone === v, key: 'phone-' + v }) + 10;
            });
            const cp = phone === 'carplay';
            small(cv, th, (cp ? ctl.statusText() : ctl.aaStatusText()) + (ctl.restartText() ? '  \u00b7  ' + ctl.restartText() : ''), 48, py + 70, 712);
            small(cv, th, cp ? ctl.wifiText() : ctl.zoomText(), 48, py + 98, cp ? 712 : 300, th.dim);
            let bx = 48;
            const by = py + 112;
            const btn = (text, run, opts) => { bx += G.button(cv, th, bx, by, 0, 42, text, run, opts) + 10; };
            if (cp) {
                if (ctl.reinstallWanted()) btn(t('Reinstall patch'), () => ctl.reinstallMap(), { primary: true, busy: !ctl.canReinstall(), key: 'cp-reinstall' });
                else btn(t('Patch'), () => ctl.enableMap(), { primary: ctl.canEnable(), busy: !ctl.canEnable(), key: 'cp-patch' });
                btn(t('Remove patch'), () => ctl.disableMap(), { confirm: true, busy: !ctl.canDisable(), key: 'cp-unpatch' });
            } else {
                btn(t('Patch'), () => ctl.enableAa(), { primary: ctl.canEnableAa(), busy: !ctl.canEnableAa(), key: 'aa-patch' });
                btn(t('Remove patch'), () => ctl.disableAa(), { confirm: true, busy: !ctl.canDisableAa(), key: 'aa-unpatch' });
                G.button(cv, th, 360, py + 74, 56, 36, '-', () => ctl.zoom(-ZOOM_STEP), { busy: !ctl.canZoom(-ZOOM_STEP), key: 'zoom-' });
                G.button(cv, th, 424, py + 74, 56, 36, '+', () => ctl.zoom(ZOOM_STEP), { busy: !ctl.canZoom(ZOOM_STEP), key: 'zoom+' });
                cv.text(fit(cv, ctl.cardText(), 20, 180, 'label'), 500, py + 98, 20, ctl.canToggleCard() ? th.text : th.dim, { font: 'label' });
                toggle(cv, th, 684, py + 72, ctl.cardHidden(), () => ctl.toggleCard(), 'card', !ctl.canToggleCard());
            }
            if (ctl.restartNeeded() || ctl.restartOffered()) {
                btn(t('Restart head unit'), () => ctl.requestRestart(), { confirm: true, primary: ctl.canRestart(), busy: !ctl.canRestart(), key: 'restart' });
            }

            G.panel(cv, th, 804, 44, 772, 468, t('HUD map'));
            const ph = hudPicture(cv, th, 828, 116, 400);
            line(cv, th, ctl.hudBrightnessText(), 828, 116 + ph + 40, 400);
            line(cv, th, ctl.hudPositionText(), 828, 116 + ph + 76, 400, th.dim);
            const can2 = ctl.canChangeHudSize(), step = ctl.hudSizeStep();
            const row = (y, title, value, minus, plus, canMinus, canPlus, key) => {
                label(cv, th, title, 1256, y);
                cv.text(value, 1256, y + 40, 28, th.text, { font: 'bold' });
                G.button(cv, th, 1408, y + 6, 60, 48, '-', minus, { busy: !canMinus, key: key + '-' });
                G.button(cv, th, 1480, y + 6, 60, 48, '+', plus, { busy: !canPlus, key: key + '+' });
            };
            const w = ctl.hudWidth();
            row(128, t('Size'), w == null ? '--' : w === 0 ? t('Standard') : t('{0} %', w), () => ctl.setHudSizeStep(step - 1),
                () => ctl.setHudSizeStep(step + 1), can2 && step > 0, can2 && step !== null && step < HUD_SIZE_STEPS, 'size');
            const br = ctl.hudBrightness();
            row(218, t('Brightness'), br == null ? '--' : t('{0} %', br), () => ctl.stepHudBrightness(-1), () => ctl.stepHudBrightness(1),
                ctl.canChangeHudBrightness(-1), ctl.canChangeHudBrightness(1), 'bright');
            label(cv, th, t('Position'), 1256, 308);
            [['up', 1376, 320, '^'], ['left', 1304, 376, '<'], ['right', 1448, 376, '>'], ['down', 1376, 432, 'v']].forEach(([dir, px, py, glyph]) =>
                G.button(cv, th, px, py, 60, 48, glyph, () => ctl.moveHud(dir), { busy: !can2, key: 'move-' + dir }));
            G.button(cv, th, 1376, 376, 60, 48, 'o', () => ctl.centreHud(), { busy: !ctl.canCentreHud(), key: 'centre' });
        }

        function drawDisplay(cv, th) {
            G.panel(cv, th, 24, 44, 640, 468, t('On the HUD'));
            HUD_ITEMS.forEach(([key, text], i) => {
                const y = 96 + i * 62;
                line(cv, th, t(text), 48, y + 30, 480);
                toggle(cv, th, 564, y + 4, !!settings.get(key), () => settings.set(key, !settings.get(key)), 'hud-' + key);
                if (i) cv.fillRect(48, y - 8, 592, 1, withAlpha('#ffffff', 0.08));
            });
            // one reading between the turn signals
            cv.fillRect(48, 214, 592, 1, withAlpha('#ffffff', 0.08));
            label(cv, th, t('Between the turn signals'), 48, 254);
            const now = settings.get('hudData');
            HUD_DATA.forEach(([v, text], i) =>
                G.button(cv, th, 48 + (i % 2) * 300, 268 + Math.floor(i / 2) * 60, 288, 48, t(text), () => settings.set('hudData', v),
                    { primary: now === v, key: 'data-' + v }));

            G.panel(cv, th, 684, 44, 892, 468, t('HUD'));
            hudPicture(cv, th, 784, 100, 692);
        }

        function drawLog(cv, th) {
            const ex = G.pageBottom(cv) - G.BOTTOM;
            G.panel(cv, th, 24, 44, 1000, 468, t('Log'));
            const n = 13 + Math.floor(ex / 28), shown = lines.slice(-n);
            if (!shown.length) line(cv, th, t('Nothing logged yet'), 48, 130, 952, th.dim);
            shown.forEach((s, i) => cv.text(fit(cv, s, 20, 952, 'label'), 48, 128 + i * 28, 20, /WARN|ERROR/.test(s) ? th.warn : th.dim, { font: 'label' }));

            G.panel(cv, th, 1044, 44, 532, 468, t('Saved logs'));
            line(cv, th, logs.statusText(), 1068, 130, 484);
            logs.rows().filter(Boolean).slice(0, 2).forEach((r, i) => line(cv, th, r, 1068, 166 + i * 32, 484, th.dim));
            line(cv, th, logs.urlText(), 1068, 250, 484, th.dim);
            G.button(cv, th, 1068, 440, 0, 50, t('Save logs'), () => logs.save(), { primary: true, busy: !logs.canSave(), key: 'save' });
            const url = logs.url();
            if (url) {
                const q = qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.LOW), n2 = q.size, k = Math.floor(150 / (n2 + 2));
                const qx = 1552 - k * (n2 + 2), qy = 276;
                cv.fillRect(qx, qy, k * (n2 + 2), k * (n2 + 2), '#ffffff');
                for (let yy = 0; yy < n2; yy++) for (let xx = 0; xx < n2; xx++) if (q.getModule(xx, yy)) cv.fillRect(qx + k * (xx + 1), qy + k * (yy + 1), k, k, '#000000');
                line(cv, th, t('Scan on a phone on the hotspot'), 1068, 310, qx - 1088, th.dim);
            }
            line(cv, th, t('Cluster functions') + ' ' + ctx.spec.version, 1068, 400, 300, th.dim);
        }

        let logsOpen = false;
        async function render(force) {
            if (!force && drawn === version) return;
            drawn = version;
            const want = page === 2;
            if (want !== logsOpen) { logsOpen = want; if (want) logs.open(); else logs.close(); }
            const th = ctx.theme();
            const cv = ctx.canvas(W, H).clear(th.bg);
            [drawMaps, drawDisplay, drawLog][page](cv, th);
            G.frame(cv, th, PAGES.map((p) => t(p)), page, []);
            await ui.image('MAIN_GFX', cv);
        }

        ui.onClick('BTN_PAGE', () => { page = (page + 1) % PAGES.length; changed(); });
        ctx.hideButton('BTN_PAGE');
        ctx.onTab((i) => { if (i !== page && i < PAGES.length) { page = i; changed(); } });
        ctx.onLayout(changed);
        G.onConfirm(changed);
        ctx.loop('MAIN', 4, () => render(false));
        const redraw = () => { changed(); setTimeout(changed, 600); };
        ui.onVisible((name, on) => {
            if (name === 'MAIN' && on) redraw();
            if (name === 'MAIN' && !on && logsOpen) { logsOpen = false; logs.close(); }
        });
        render(true).catch((e) => log.warn('first render: ' + e));
    },
});

module.exports = { gearText, HUD_STATES, CATALOG_ERRORS };
