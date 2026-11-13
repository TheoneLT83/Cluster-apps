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
 *   (A car without a head-up display, setting HUD installed No: no HUD map panel, HUD tab or HUD choices.)
 *   Settings  the kit's settings sheet: Displays on HUD (off: nothing of this app on the HUD), Real speed on HUD (left of BMW's own speed), the colours, the
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
const { HudOverlay, drawLight, LIGHT_HUD, anchorRect, mapRect, gearRect, arrowRect, dataRect, drawArrow, drawData, drawGear, HUD_W, HUD_H, ARROW, GREEN, SPEED_RECT } = require('./hud_overlay.js');
const { HvData } = require('./hv_data.js');
const { MoreData } = require('./more_data.js');
const PANEL = require('./cluster_panel.js');
const { HudClaim } = require('./kit/hud_claim');
const { GreenLight } = require('./green_light.js');
const { Units } = require('./units.js');
const { TurnSignals } = require('./turn_signals.js');
const { ProfileSync, sessionReader } = require('./profile_sync.js');
const qrcodegen = require('./qrcodegen.js');

const { t } = i18n;
const W = 1600, H = 520;
const PAGES = ['Maps', 'Display', 'Log'];
/* The Display page's switches, its HUD tab's and its Cluster tab's: the setting, its words. */
const HUD_ITEMS = [['hudOn', 'Displays on HUD'], ['hudTurn', 'Turn signals'], ['hudGear', 'Gear'], ['realSpeed', 'Real speed on HUD'],
    ['greenLightHud', 'Green light alert'], ['hudNight', 'Dimmer at night']];
const CLUSTER_ITEMS = [['greenLightCluster', 'Green light alert'], ['clusterPanel', 'Info bar']];
/* The picture's "GO" in its loop: shown GO_DEMO_ON of each GO_DEMO_MS while that alert is on. */
const GO_DEMO_MS = 4000, GO_DEMO_ON = 1500;
/* The car's day / night enum (setting hudNight: the HUD map darker at night, waze_cluster_control nightDim). */
const DAY_NIGHT = { KEINE_AENDERUNG: 0, TAG: 1, NACHT: 2, SIGNAL_UNGUELTIG: 3 };
/* The part of the HUD's 800 x 480 scene the glass shows, about (a G21's, Redline's hud.js), with BMW's speed row. */
const HUD_GLASS = { x: 80, y: 100, w: 640, h: 290 };
/* The HUD's readings in the row under the map, up to HUD_DATA_MAX at once, in this order: the reading, its setting,
 * its words (hudData: the one reading an earlier version chose, taken over once). */
const HUD_DATA_MAX = 3;
const HUD_DATA = [['ev', 'hudEv', 'Electric range'], ['soc', 'hudSoc', 'Battery charge'], ['temps', 'hudTemps', 'Oil and coolant'],
    ['boost', 'hudBoost', 'Boost'], ['power', 'hudPower', 'Power and torque'], ['rpm', 'hudRpm', 'Engine speed'],
    ['tyres', 'hudTyres', 'Tyre pressures'], ['gearbox', 'hudGearbox', 'Gearbox oil'], ['fuel', 'hudFuel', 'Fuel range'],
    ['clock', 'hudClock', 'Clock and drive time']];
/* The cluster's info bar (cluster_panel.js): its items, each switched on the Display page (up to PANEL_MAX): the item,
 * its setting, its words. */
const PANEL_ITEMS = [['power', 'clusterKw', 'Battery kW usage'], ['soc', 'clusterSoc', 'Battery charge'], ['oil', 'clusterOil', 'OIL'],
    ['coolant', 'clusterCoolant', 'COOLANT'], ['boost', 'clusterBoost', 'Boost'], ['rpm', 'clusterRpm', 'Engine speed'],
    ['torque', 'clusterTorque', 'TORQUE'], ['speed', 'clusterSpeed', 'Real speed'], ['tyres', 'clusterTyres', 'Tyre pressures'],
    ['gearbox', 'clusterGearbox', 'Gearbox oil'], ['fuel', 'clusterFuel', 'Fuel range'], ['clock', 'clusterClock', 'Clock'],
    ['drive', 'clusterDrive', 'Drive time']];
const PANEL_MAX = 4;
/* An info bar item the car and the settings offer: the battery's only with eDrive, Real speed only with its setting. */
const offers = (k, hv, settings) => (k !== 'power' && k !== 'soc' || hv.installed()) && (k !== 'speed' || !!settings.get('realSpeedCluster'));
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


/* MDrive.dataDisplayGearbox: the programme the cluster shows beside the gear (names or wire numbers). */
const PROGRAMS = { S_MINUS_PROGRAMM: 'S', M_MINUS_PROGRAMM: 'M', 1: 'S', 2: 'M' };

/* P / R / N / D, D1 ... D9, S1 ... S8 (sport), M1 ... M8 (manual) from car.js's data: its gear (-1 R, 0 N/P, 1...),
 * the selector stage and the programme (program: the cluster's, else the gearbox status's mode). */
function gearText(d) {
    if (!d) return null;
    const p = d.program || (d.mode === 'S' || d.mode === 'M' ? d.mode : null);
    const ahead = (g) => (p || 'D') + (G.isNum(g) && g > 0 ? g : '');
    if (d.stage === 'D') return ahead(d.gear);
    if (d.stage) return d.stage;
    if (!G.isNum(d.gear)) return p;
    return d.gear < 0 ? 'R' : d.gear === 0 ? p || 'N' : ahead(d.gear);
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
        s._en = s._en || { label: s.label, group: s.group, options: (s.options || []).map((o) => o[1]) };
        s.label = t(s._en.label);
        if (s._en.group) s.group = t(s._en.group);
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

    // the HUD map's brightness as chosen, kept here: at night the render shows it darker (hudNight)
    const ctl = new WazeClusterControl({ log, dayBright: { get: () => settings.get('hudDayBright'), set: (v) => settings.set('hudDayBright', v) } });
    const logs = new LogsControl({ log });
    const turns = new TurnSignals({ signals: bg.signals, log });
    // the map settings per driver profile (the head unit's user account), page shown or not
    let readProfile = null;
    try { readProfile = sessionReader(require('oap-sdk').someipBuilders, log); } catch (e) { log.warn('driver profiles unavailable: ' + e.message); }
    const profiles = new ProfileSync({ control: ctl, log, readProfile });
    const hud = new HudOverlay({ log });
    // a car without a head-up display (setting hudInstalled No): nothing of ours on it, and none of its settings or pages
    const hudOk = () => settings.get('hudInstalled') !== 'no';
    // another app holding the HUD (Redline turned on, until the car is switched off; kit/hud_claim.js): ours gives way
    let givenTo = [];
    const given = () => givenTo.length > 0;
    // boost from the sport display (FES), as M Vitals reads it: bar, 0.01 a step, 255 no value
    let boost = null, program = null;
    const programSeen = [];
    const car = new Car(Object.assign({}, bg, { log }), ['gear', 'speed', 'rpm', 'temps', 'torque'], {
        'de.bmw.infotainment.drivingexcitement.FES': {
            statusSwitchDriveDynamicSport2: (v) => { const r = v && v.displayBoostPressure; boost = G.isNum(r) && r !== 255 ? r * 0.01 : null; },
        },
        // S or M beside the gear, as the cluster shows it
        'de.bmw.infotainment.misc.MDrive': {
            dataDisplayGearbox: (v) => {
                const raw = v && v.displayProgramGearbox;
                if (programSeen.length < 12 && programSeen.indexOf(String(raw)) < 0) { programSeen.push(String(raw)); log.info('gear programme: ' + JSON.stringify(raw)); }
                program = PROGRAMS[raw] || null;
            },
        },
    });
    const units = new Units({ settings, appRoot: bg.dataDir && path.dirname(bg.dataDir), log });
    // the electric range only while eDrive is installed (it has the battery's numbers)
    const hv = new HvData({ log, appRoot: bg.dataDir && path.dirname(bg.dataDir) });
    // tyre pressures, gearbox oil, the fuel range, the clock and the drive time (more_data.js)
    const more = new MoreData({ signals: bg.signals, log }).start();
    // an earlier version's one reading (hudData) becomes its switch, once
    { const was = settings.get('hudData'), it = HUD_DATA.find(([v]) => v === was); if (it) { settings.set(it[1], true); settings.set('hudData', 'off'); } }
    /* The HUD's readings switched on that this car has (the battery's with eDrive), up to HUD_DATA_MAX. */
    const dataChoices = () => HUD_DATA.filter(([v, key]) => settings.get(key) && ((v !== 'ev' && v !== 'soc') || hv.installed())).map(([v]) => v)
        .slice(0, HUD_DATA_MAX);
    /* The cluster's info bar (cluster_panel.js): the items switched on (the battery's only with eDrive; none of them:
     * oil, coolant and engine speed), while the Waze map shows on the cluster and setting clusterPanel is on. */
    const panelKinds = () => {
        const on = PANEL_ITEMS.filter(([k, key]) => settings.get(key) && offers(k, hv, settings)).map(([k]) => k);
        return (on.length ? on : ['oil', 'coolant', 'rpm']).slice(0, PANEL_MAX);
    };
    const panelOn = () => settings.get('clusterPanel') !== false && ctl.clusterOn() === true && !!ctl.renderStatus && ctl.renderStatus.state === 'showing';
    const panelItems = (kinds) => {
        const d = car.data(), real = d && !d.demo ? d : {};
        const val = (label, v, text, cold) => ({ kind: 'value', label, text: G.isNum(v) ? text : '--', cold: G.isNum(v) && !!cold });
        return (kinds || panelKinds()).map((k) => {
            if (k === 'power') { const kw = hv.powerShown(); return { kind: 'power', kw: G.isNum(kw) ? Math.round(kw * 10) / 10 : null, limits: hv.limits() }; }
            if (k === 'soc') { const soc = hv.soc(); return val('SOC', soc, Math.round(soc) + '%'); }
            if (k === 'oil') return val(t('OIL'), real.oil, Math.round(real.oil) + '°', real.oil < PANEL.COLD_C);
            if (k === 'coolant') return val(t('COOLANT'), real.coolant, Math.round(real.coolant) + '°', real.coolant < PANEL.COLD_C);
            if (k === 'rpm') return val('RPM', real.rpm, String(Math.round(real.rpm / 10) * 10));
            if (k === 'speed') return val('KM/H', real.speed, String(Math.round(real.speed)));
            if (k === 'tyres') return { kind: 'tyres', bar: more.tyres() || {}, low: more.lowTyre() };
            if (k === 'gearbox') { const g = more.gearbox(); return val(t('GEARBOX'), g, Math.round(g) + '°', g < PANEL.COLD_C); }
            if (k === 'fuel') { const r = more.range(); return val(t('RANGE'), r, String(Math.round(r))); }
            if (k === 'clock') return { kind: 'value', label: t('TIME'), text: more.clock() };
            if (k === 'drive') return { kind: 'value', label: t('DRIVE'), text: more.driveTime() };
            if (k === 'boost') {
                const b = units.boost(G.isNum(boost) && !(d && d.demo) ? boost : NaN);
                return val(b.unit.toUpperCase(), b.value, b.unit === 'bar' ? (b.value || 0).toFixed(1) : String(Math.round(b.value)));
            }
            const q = units.torque(G.isNum(real.torque) ? real.torque : NaN);
            return val(q.unit.toUpperCase(), q.value, String(Math.round(q.value)));
        });
    };
    const toPanel = () => hud.panel(panelOn() ? panelItems() : null);
    // the battery unit is read only while its power, charge or range is shown; eDrive is told which (hv_data.js WANTED)
    const hvWanted = () => {
        const hudShows = settings.get('hudOn') !== false && hudOk() ? dataChoices() : [], kinds = settings.get('clusterPanel') !== false ? panelKinds() : [];
        const power = hudShows.some((c) => c === 'ev' || c === 'power') || kinds.indexOf('power') >= 0, soc = hudShows.indexOf('soc') >= 0 || kinds.indexOf('soc') >= 0;
        hv.want({ power, soc });
        if (power || soc) hv.start(); else hv.stop();
    };
    // the HUD map darker at night (the car's light sensor), with setting hudNight; the info bar, the turn signals and the
    // gear stay as bright as BMW's own speed
    let night = false;
    const dimNow = () => ctl.nightDim(night && settings.get('hudNight') !== false);
    bg.signals.watch('de.bmw.infotainment.vehicle.Vehicle', '1', {
        statusDayNightChangeOver: (v) => {
            const x = v && typeof v === 'object' ? v.dayNightChangeOver : v, c = typeof x === 'string' ? DAY_NIGHT[x] : x;
            if (c === 1 || c === 2) { if (night !== (c === 2)) log.info('HUD: ' + (c === 2 ? 'night' : 'day')); night = c === 2; dimNow(); }
        },
    }, log).catch((e) => log.warn('day / night: ' + e.message));
    const mapNow = () => mapRect(ctl.hudWidth() || 0, ctl.hudOffset() || [0, 0]);
    // the HUD shows the car's gear only, never demo data
    const gearNow = () => { const d = car.data(); return d && !d.demo ? gearText(Object.assign({}, d, { program })) : null; };
    /* The data under the map (hud_overlay.js drawData), the car's own only; preview: every chosen one, '--' for
     * a value not known. */
    const dataNow = (preview) => {
        const d = car.data(), real = d && !d.demo ? d : {}, out = [];
        // cold: blue under PANEL.COLD_C, as the cluster's info bar (oil, coolant, gearbox oil)
        const value = (label, v, unit, cold) => { if (G.isNum(v) || preview) out.push({ kind: 'value', label, text: G.isNum(v) ? Math.round(v) + unit : '--', cold: !!cold && G.isNum(v) && v < PANEL.COLD_C }); };
        const slider = (v, min, max, text, green, color) => { if (G.isNum(v) || preview) out.push({ kind: 'slider', value: G.isNum(v) ? v : null, min, max, text, green, color }); };
        dataChoices().forEach((c) => {
            if (c === 'ev') {
                // eased between eDrive's readings; blue out, green recuperating, amber from 60 kW (as the cluster's bar): zero a
                // quarter along, each side up to the battery's limit
                const kw = hv.powerShown(), lim = hv.limits() || {}, out = lim.out || PANEL.MAX_OUT, inn = lim.in || PANEL.MAX_IN;
                slider(G.isNum(kw) ? (kw >= 0 ? 3 * Math.min(1, kw / out) : -Math.min(1, -kw / inn)) : null, -1, 3, G.isNum(kw) ? Math.round(Math.abs(kw)) : '', G.isNum(kw) && kw < 0,
                    !G.isNum(kw) ? null : kw < 0 ? PANEL.GREEN : kw >= PANEL.AMBER_KW ? PANEL.AMBER : PANEL.BLUE);
                value(t('EV'), hv.range(), ' km');
            } else if (c === 'soc') {
                value('SOC', hv.soc(), '%');
            } else if (c === 'boost') {
                const b = units.boost(G.isNum(boost) && !(d && d.demo) ? boost : NaN);
                slider(b.value, 0, b.max, G.isNum(b.value) ? (b.unit === 'bar' ? b.value.toFixed(1) : Math.round(b.value)) + ' ' + b.unit : '');
            } else if (c === 'power') {
                // the engine's (torque x rpm), and on a hybrid what the battery gives the motor (eDrive's), so electric driving shows
                const nm = real.torque, rpm = real.rpm, engine = G.isNum(nm) && G.isNum(rpm) ? Math.max(0, nm * rpm / 9549) : null, kw = hv.power();
                const p = units.power(engine === null && !G.isNum(kw) ? NaN : (engine || 0) + (G.isNum(kw) ? Math.max(0, kw) : 0));
                const q = units.torque(G.isNum(nm) ? nm : NaN);
                value(t('POWER'), p.value, ' ' + p.unit);
                value(t('TORQUE'), q.value, ' ' + q.unit);
            } else if (c === 'rpm') {
                slider(real.rpm, 0, RPM_MAX, G.isNum(real.rpm) ? Math.round(real.rpm / 10) * 10 : '');
            } else if (c === 'temps') {
                value(t('OIL'), real.oil, '°', true);
                value(t('COOLANT'), real.coolant, '°', true);
            } else if (c === 'tyres') {
                // the lowest tyre, red while one is low
                const p = more.tyres(), lows = p ? Object.keys(p).map((w) => p[w]).filter(G.isNum) : [];
                if (lows.length || preview) out.push({ kind: 'value', label: t('TYRES'), text: lows.length ? Math.min.apply(null, lows).toFixed(1) + ' bar' : '--', warn: more.lowTyre().length > 0 });
            } else if (c === 'gearbox') {
                value(t('GEARBOX'), more.gearbox(), '°', true);
            } else if (c === 'fuel') {
                value(t('RANGE'), more.range(), ' km');
            } else if (c === 'clock') {
                out.push({ kind: 'value', label: t('TIME'), text: more.clock() });
                out.push({ kind: 'value', label: t('DRIVE'), text: more.driveTime() });
            }
        });
        return out;
    };
    // the car's own speed (a mileage blocker leaves it alone), with the setting realSpeed
    const speedNow = () => { const d = car.data(); return settings.get('realSpeed') && d && !d.demo && G.isNum(d.speed) ? Math.round(d.speed) : null; };
    // Displays on HUD off: nothing of ours on the HUD, which the renderer then gives back to BMW's own layout
    const toHud = () => (settings.get('hudOn') === false || !hudOk() || given() ? hud.update({ turn: {}, gear: null, map: mapNow(), showTurn: false, showGear: false,
        data: [], speed: null }) : hud.update({
        turn: turns.state(), gear: gearNow(), map: mapNow(),
        showTurn: !!settings.get('hudTurn'), showGear: !!settings.get('hudGear'), data: dataNow(false), speed: speedNow(),
    }));
    car.onSample(() => { toHud(); changed(); });
    hv.on('change', () => { toHud(); changed(); });
    more.on('change', () => { toHud(); toPanel(); changed(); });
    ctl.on('change', () => { toHud(); changed(); });
    logs.on('change', changed);
    profiles.on('change', changed);
    turns.on('change', () => { toHud(); changed(); });
    settings.onChange(() => { hvWanted(); claims(); toHud(); toPanel(); dimNow(); changed(); });
    // boost, torque, the temperatures and the programme come without a sample of their own: the HUD looks again
    // often (only what changed is sent; the layers take up to 25 frames a second)
    setInterval(() => { if (settings.get('hudOn') !== false && hudOk() && !given()) toHud(); toPanel(); }, 80);
    const claims = () => {
        HudClaim.standing('robertn_waze_cluster', settings.get('hudOn') !== false && hudOk());
        const now = hudOk() ? HudClaim.others('robertn_waze_cluster') : [];
        if (now.join() === givenTo.join()) return;
        log.info(now.length ? 'HUD: given to ' + now.join(', ') + ' while it holds it' : 'HUD: ours again');
        givenTo = now;
        ctl.yieldHud(given());
        toHud(); changed();
    };
    setInterval(claims, 1000);
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
        say('cp-conflict', ctl.conflictDetail(false) && 'CarPlay patch: ' + ctl.conflictDetail(false));
        say('aa-conflict', ctl.conflictDetail(true) && 'Android Auto patch: ' + ctl.conflictDetail(true));
        const d = car.data();
        say('gear', d && d.demo ? 'demo: no gear from the car' : gearNow() ? 'gear from the car' : 'no gear from the car yet');
    };
    setInterval(sayStates, 2000);
    turns.start();
    // the light ahead turned green while the car waits: "GO" on the cluster, and on the HUD while ours is shown there
    const green = new GreenLight({ signals: bg.signals, log, speed: () => { const d = car.data(); return d && !d.demo ? d.speed : null; } });
    green.on('go', (on) => {
        hud.go(on && settings.get('greenLightHud') !== false && hudOk() && settings.get('hudOn') !== false && !given(),
            on && settings.get('greenLightCluster') !== false);
    });
    green.start().catch((e) => log.warn('green light: ' + e.message));

    ctl.open();
    profiles.start();
    toHud();
    // a map set to show on a HUD this car does not have goes to the cluster (once the render and patchd answer)
    const toCluster = () => {
        if (hudOk() || ['hud', 'both'].indexOf(ctl.shownOn()) < 0 || !ctl.canChooseShownOn()) return;
        log.info('no HUD: the map shows on the cluster');
        ctl.showOn('cluster');
    };
    ctl.on('change', toCluster);
    settings.onChange((key) => { if (key === 'hudInstalled') toCluster(); });
    log.info('Cluster functions ' + bg.spec.version + ' started (' + (bg.app && bg.app.startReason) + ')');
    return { ctl, logs, turns, hud, hv, profiles, car, lines, log, mapNow, gearNow, dataNow, dataChoices, hudOk, green, panelKinds, panelItems, onChange: (fn) => listeners.push(fn) };
}

mgu.run({
    background,

    async start(ctx) {
        const { ui, settings } = ctx;
        const b = ctx.background || await background(ctx);
        const { ctl, logs, turns, hud, hv, profiles, car, lines, log, mapNow, gearNow, dataNow, dataChoices, hudOk, green, panelKinds, panelItems } = b;
        let page = 0, version = 0, drawn = -1, blink = true, phone = 'carplay';
        // the kit's header and Settings tab in the display language too
        const changed = () => {
            version++;
            ctx.display.settingsLabel = t('Settings');
            if (ctx.display.screen) ctx.display.screen.title = t('Cluster functions');
        };
        b.onChange(changed);
        // the turn signals' blink; the Display page's pictures move with it
        setInterval(() => { blink = !blink; if (turns.state().test || pagesNow()[page] === 'Display') changed(); }, 400);
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
        /* crop: the part of the HUD's scene to show (the Display page: the part the glass shows), else all of it */
        // the HUD's picture; with crop (the glass, the Display page): cut at the glass's edge, so a big map and our parts
        // never run out of the picture
        const hudPicture = (cv, th, x0, y0, w, crop) => {
            if (!crop || cv.glass) return drawHudPicture(cv, th, x0, y0, w, crop);
            const ww = Math.round(w), hh = Math.round(crop.h * w / crop.w);
            // the GPU renderer's canvas clips; the software one draws it on a canvas of its own
            if (cv.clip) {
                cv.clip(Math.round(x0), Math.round(y0), ww, hh);
                cv.glass = true;
                try { drawHudPicture(cv, th, x0, y0, ww, crop); } finally { cv.glass = false; cv.noclip(); }
                cv.strokeRoundRect(Math.round(x0), Math.round(y0), ww, hh, 10, 1.5, withAlpha('#ffffff', 0.25));
                return hh;
            }
            const off = ctx.canvas(ww, hh).clear('#05070a');
            off.glass = true; off.own = cv.own;
            drawHudPicture(off, th, 0, 0, ww, crop);
            cv.blit(off, Math.round(x0), Math.round(y0));
            cv.strokeRoundRect(Math.round(x0), Math.round(y0), ww, hh, 10, 1.5, withAlpha('#ffffff', 0.25));
            return hh;
        };
        const drawHudPicture = (cv, th, x0, y0, w, crop) => {
            const c = crop || { x: 0, y: 0, w: HUD_W, h: HUD_H }, k = w / c.w, h = c.h * k;
            cv.roundRect(x0, y0, w, h, 10, '#05070a');
            cv.strokeRoundRect(x0, y0, w, h, 10, 1.5, withAlpha('#ffffff', 0.25));
            const x = x0 - c.x * k, y = y0 - c.y * k;
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
            // on the Display page, the arrows blink one side then the other while the car's are off
            const real = turns.state(), cyc = Date.now() % 3000;
            const st = demoTurns && !real.left && !real.right ? { left: cyc < 1500, right: cyc >= 1500 } : real;
            const ours = settings.get('hudOn') !== false;      // Displays on HUD: our parts at all
            if (ours && settings.get('hudTurn')) {
                const [aw, ah] = ARROW.medium;
                ['left', 'right'].forEach((side) => {
                    const r = arrowRect(m, side, aw, ah);
                    drawArrowAt(cv, x + r.x * k, y + r.y * k, r.w * k, r.h * k, side === 'left' ? -1 : 1,
                        st[side] && blink ? GREEN : withAlpha(GREEN, 0.18));
                });
            }
            if (ours && settings.get('hudGear')) {
                const g = gearRect();
                drawGear(cv, gearText(car.data()) || 'D', { k, x: x + g.x * k, y: y + g.y * k, alpha: gearNow() ? undefined : 0.35 });
            }
            if (ours && settings.get('realSpeed')) {
                const sp = car.data() && !car.data().demo && G.isNum(car.data().speed) ? Math.round(car.data().speed) : null;
                cv.text(sp === null ? '--' : String(sp), x + (SPEED_RECT.x + SPEED_RECT.w) * k, y + (SPEED_RECT.y + SPEED_RECT.h - 8) * k, 40 * k,
                    sp === null ? withAlpha('#f2f5f8', 0.35) : '#f2f5f8', { font: 'bold', align: 'right' });
            }
            const dr = ours && dataChoices().length ? dataRect(m) : null;
            if (dr) drawData(cv, x + dr.x * k, y + dr.y * k, dr.w * k, dataNow(true), k);
            return h;
        };

        /* ---- the pages ---- */
        const pagesNow = () => PAGES;
        let dispTab = 'cluster';
        let demoTurns = false;         // hudPicture's arrows blink by themselves (the Display page)           // the Display page's tab: 'hud' or 'cluster' (the HUD's only with one)
        function drawMaps(cv, th) {
            const ex = G.pageBottom(cv) - G.BOTTOM;
            G.panel(cv, th, 24, 44, 760, 468, t('Map'));
            label(cv, th, t('Show on'), 48, 120);
            const on = ctl.shownOn(), can = ctl.canChooseShownOn();
            let x = 48;
            [['cluster', 'Cluster'], ['hud', 'HUD'], ['both', 'Cluster + HUD']].filter(([v]) => v === 'cluster' || hudOk()).forEach(([v, text]) => {
                x += G.button(cv, th, x, 130, 0, 44, t(text), () => ctl.showOn(v), { primary: on === v, busy: !can, key: 'show-' + v }) + 10;
            });
            small(cv, th, ctl.mapText(), 48, 204, 712);
            if (hudOk()) small(cv, th, ctl.hudText(), 48, 230, 712, ctl.hudDisabled() ? th.warn : null);
            // the map settings of this driver profile, its own or the shared ones (greyed while no profile is known)
            // (BMW's logo on the cluster: the Display page, Cluster)
            const po = profiles.canChooseOwn();
            cv.text(fit(cv, t('Own settings for this driver'), 22, 258, 'label'), 48, 276, 22, po ? th.text : th.dim, { font: 'label' });
            toggle(cv, th, 314, 252, profiles.ownShown(), () => profiles.setOwn(!profiles.ownShown()), 'profile-own', !po);

            // the phone: CarPlay or Android Auto, its patch and its own settings
            cv.fillRect(48, 300 + ex / 4, 712, 1, withAlpha('#ffffff', 0.12));
            const py = 312 + ex / 4;
            x = 48;
            [['carplay', 'CarPlay'], ['aa', 'Android Auto']].forEach(([v, name]) => {
                x += G.button(cv, th, x, py, 0, 42, name, () => { phone = v; changed(); }, { primary: phone === v, key: 'phone-' + v }) + 10;
            });
            const cp = phone === 'carplay';
            small(cv, th, (cp ? ctl.statusText() : ctl.aaStatusText()) + (ctl.restartText() ? '  \u00b7  ' + ctl.restartText() : ''), 48, py + 70, 712);
            // why the patch cannot be applied (patchd's own words), else the Wi-Fi band or the zoom
            const why = ctl.conflictDetail(!cp).replace(/^not supported on this car \((.*)\)$/, '$1');
            small(cv, th, why || (cp ? ctl.wifiText() : ctl.zoomText()), 48, py + 98, cp ? 712 : 300, th.dim);
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

            if (!hudOk()) return;          // no head-up display: no HUD map panel
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

        /* A picture of the cluster: its two dials, the map in the middle while it shows there, "GO" over it. */
        const clusterPicture = (cv, th, x, y, w, go) => {
            const h = Math.round(w * 720 / 1920), r = Math.min(h * 0.4, w * 0.13);
            cv.roundRect(x, y, w, h, 12, '#05070a');
            cv.strokeRoundRect(x, y, w, h, 12, 1.5, withAlpha('#ffffff', 0.25));
            [x + w * 0.16, x + w * 0.84].forEach((cx) => {
                cv.arc(cx, y + h * 0.55, r - 4, r, -130, 130, withAlpha('#ffffff', 0.35));
                const ang = (blink ? -40 : 25) * Math.PI / 180;      // the needle swings with the blink
                cv.line(cx, y + h * 0.55, cx + r * 0.6 * Math.sin(ang), y + h * 0.55 - r * 0.6 * Math.cos(ang), 3, '#ff4040');
            });
            const mx = x + w * 0.33, my = y + h * 0.18, mw = w * 0.34, mh = h * 0.64;
            if (ctl.clusterOn() === true) {
                cv.roundRect(mx, my, mw, mh, 8, '#1c3a2c');
                cv.polyline([[mx + mw * 0.5, my + mh * 0.92], [mx + mw * 0.5, my + mh * 0.5], [mx + mw * 0.38, my + mh * 0.42], [mx + mw * 0.35, my + mh * 0.08]], 4, '#7ee05a');
            } else cv.strokeRoundRect(mx, my, mw, mh, 8, 1, withAlpha('#ffffff', 0.15));
            // the maker's logo at the top of the middle while it is not hidden
            if (!ctl.hideGuidance()) {
                const lr = h * 0.06;
                cv.circle(x + w / 2, y + h * 0.1, lr, withAlpha('#ffffff', 0.7));
                cv.circle(x + w / 2, y + h * 0.1, lr * 0.62, '#1f6fd1');
            }
            // the info bar, a little low in the middle, at the picture's scale
            if (settings.get('clusterPanel') !== false) {
                const items = panelItems(panelKinds()), ps = PANEL.panelSize(items), k = Math.min(mw * 0.96 / ps.w, mh * 0.42 / ps.h);
                const sc = { roundRect: (a, b, ww, hh, rr, c) => cv.roundRect(a, b, ww, hh, rr, c), fillRect: (a, b, ww, hh, c) => cv.fillRect(a, b, ww, hh, c),
                    text: (s2, a, b, sz, c, o) => cv.text(s2, a, b, sz, c, o) };
                const px = x + (w - ps.w * k) / 2, py = my + mh - ps.h * k - 4;
                const kc = { roundRect: (a, b, ww, hh, rr, c) => sc.roundRect(px + (a - 0) * k, py + b * k, ww * k, hh * k, rr * k, c),
                    fillRect: (a, b, ww, hh, c) => sc.fillRect(px + a * k, py + b * k, ww * k, hh * k, c),
                    text: (s2, a, b, sz, c, o) => sc.text(s2, px + a * k, py + b * k, sz * k, c, o) };
                PANEL.drawPanel(kc, 0, 0, items);
            }
            if (go) {
                // small, at the top of the middle (hud_overlay LIGHT_CLUSTER)
                const lh = mh * 0.46, lw = lh * 0.375;
                drawLight(scaled(cv, mx + (mw - lw) / 2, my + mh * 0.04, 1), lw, lh);
            }
            return h;
        };
        /* cv's drawing moved to x, y and scaled by k, for hud_overlay's drawLight. */
        const scaled = (cv, x, y, k) => ({
            roundRect: (a, b, w, h, rr, c) => cv.roundRect(x + a * k, y + b * k, w * k, h * k, rr * k, c),
            strokeRoundRect: (a, b, w, h, rr, lw, c) => cv.strokeRoundRect(x + a * k, y + b * k, w * k, h * k, rr * k, lw, c),
            circle: (a, b, rr, c) => cv.circle(x + a * k, y + b * k, rr * k, c),
        });
        /* The Display page: the switches and the info bar's choices on the left (DL wide), the pictures on the right. */
        const DL = 1056, DCOL = 504, DCOLS = 4, DBTN = 243;
        function drawDisplay(cv, th) {
            const hasHud = hudOk();
            if (!hasHud) dispTab = 'cluster';
            const goNow = Date.now() % GO_DEMO_MS < GO_DEMO_ON;

            // the switches on the left: a tab for the HUD, one for the cluster
            G.panel(cv, th, 24, 44, DL, 468, null);
            let tx = 48;
            (hasHud ? [['cluster', 'Cluster'], ['hud', 'HUD']] : [['cluster', 'Cluster']]).forEach(([id, text]) => {
                tx += G.button(cv, th, tx, 60, 200, 46, t(text), () => { dispTab = id; changed(); }, { primary: dispTab === id, key: 'tab-' + id }) + 12;
            });
            // note: a smaller second line under the label (the green light alert's camera)
            const row = (i, key, text, on, run, off, note) => {
                const x = 48 + (i % 2) * DCOL, y = 118 + Math.floor(i / 2) * 54;
                line(cv, th, text, x, y + (note ? 18 : 28), DCOL - 112, off ? th.dim : null);
                if (note) cv.text(fit(cv, note.text, 16, DCOL - 112, 'label'), x, y + 40, 16, note.color, { font: 'label' });
                toggle(cv, th, x + DCOL - 100, y + 2, on, run, 'disp-' + key, off);
            };
            const flip = (key) => () => settings.set(key, settings.get(key) === false ? true : !settings.get(key));
            // under the green light alert's label: whether the car's traffic-light camera answers
            const camera = (key) => {
                const f = /^greenLight/.test(key) ? green.found() : null;
                return f === null ? null : { text: f ? t('Traffic-light camera found') : t('Traffic-light camera not found'), color: f ? th.dim : th.warn };
            };
            if (dispTab === 'hud') {
                const hudOnNow = settings.get('hudOn') !== false;
                HUD_ITEMS.forEach(([key, text], i) => row(i, key, t(text), settings.get(key) !== false && !!settings.get(key), flip(key), key !== 'hudOn' && !hudOnNow, camera(key)));
                // BMW's HUD pop-ups (calls, media, lists): the map gives way to them, or stays over them
                {   // its own line, across both columns (a long label)
                    const y = 118 + Math.ceil(HUD_ITEMS.length / 2) * 54, off = !hudOnNow || !ctl.canKeepHud();
                    line(cv, th, t("Keep HUD map over BMW's pop-ups"), 48, y + 28, DCOL - 112, off ? th.dim : null);
                    toggle(cv, th, 48 + DCOL - 100, y + 2, ctl.hudKeepShown() === true, () => ctl.toggleHudKeep(), 'disp-hudKeep', off);
                }
                // the readings, as the info bar's: a button each, lit while on (up to HUD_DATA_MAX)
                const offered = HUD_DATA.filter(([v]) => (v !== 'ev' && v !== 'soc') || hv.installed());
                const count = offered.filter(([, key]) => settings.get(key)).length;
                label(cv, th, t('Info bar') + '  ' + count + '/' + HUD_DATA_MAX, 48, 356);
                const at = (i) => [48 + (i % DCOLS) * (DBTN + 12), 366 + Math.floor(i / DCOLS) * 46];
                offered.forEach(([v, key, text], i) => {
                    const lit = !!settings.get(key);
                    G.button(cv, th, at(i)[0], at(i)[1], DBTN, 40, t(text), () => settings.set(key, !lit),
                        { primary: lit, key: 'data-' + v, busy: !hudOnNow || (!lit && count >= HUD_DATA_MAX) });
                });
            } else {
                // the map on the cluster: on or off with the HUD's as it is (never on neither)
                const shown = ctl.shownOn(), clusterNow = ctl.clusterOn() === true, hudMap = ctl.hudOn() === true;
                const canMap = ctl.canChooseShownOn() && (!clusterNow || hudMap);
                row(0, 'map', t('Map'), clusterNow, () => ctl.showOn(clusterNow ? 'hud' : hudMap ? 'both' : 'cluster'), !canMap || shown === null && !ctl.canChooseShownOn());
                const gu = ctl.guidanceUnavailable(), hide = ctl.hideGuidance();
                row(1, 'guide', t('Hide logo on the cluster'), !!hide, () => ctl.toggleGuidance(), gu || hide === null);
                // the info bar shows under the map: off while the map is not on the cluster
                const noBar = (key) => key === 'clusterPanel' && !clusterNow;
                CLUSTER_ITEMS.forEach(([key, text], i) => row(2 + i, key, t(text), settings.get(key) !== false && !noBar(key), flip(key), noBar(key), camera(key)));
                // the info bar's items, as the HUD's reading: a button each, lit while on (up to PANEL_MAX)
                const barOn = settings.get('clusterPanel') !== false && clusterNow;
                const offered = PANEL_ITEMS.filter(([k]) => offers(k, hv, settings));
                const count = offered.filter(([, key]) => settings.get(key)).length;
                // how many are on, of the most; right under the switches (two rows here)
                const ly = 118 + Math.ceil((2 + CLUSTER_ITEMS.length) / 2) * 54 + 34;
                label(cv, th, t('Info bar') + '  ' + count + '/' + PANEL_MAX, 48, ly);
                const at = (i) => [48 + (i % DCOLS) * (DBTN + 12), ly + 10 + Math.floor(i / DCOLS) * 46];
                offered.forEach(([k, key, text], i) => {
                    const lit = !!settings.get(key);
                    G.button(cv, th, at(i)[0], at(i)[1], DBTN, 40, t(text), () => settings.set(key, !lit),
                        { primary: lit, key: 'item-' + k, busy: !barOn || (!lit && count >= PANEL_MAX) });
                });
            }

            // the pictures on the right: the cluster on top, the HUD under it, each showing what of ours is on there
            const px = 24 + DL + 20, pw = 1576 - px;
            G.panel(cv, th, px, 44, pw, 468, t('Display'));
            const cw = pw - 40, cx = px + 20;
            const ch = clusterPicture(cv, th, cx, hasHud ? 96 : 150, cw, goNow && settings.get('greenLightCluster') !== false);
            if (hasHud) {
                // as wide as the cluster: the part of the HUD's scene the glass shows (HUD_GLASS)
                const hw = cw, hx = cx, hy = 96 + ch + 12, hudOnNow = settings.get('hudOn') !== false;
                demoTurns = true;
                hudPicture(cv, th, hx, hy, hw, HUD_GLASS);
                demoTurns = false;
                if (hudOnNow && goNow && settings.get('greenLightHud') !== false) {
                    const k = hw / HUD_GLASS.w, a = anchorRect(mapNow());
                    drawLight(scaled(cv, hx + (a.x - HUD_GLASS.x + (a.w - LIGHT_HUD.w) / 2) * k, hy + (a.y - HUD_GLASS.y + 4) * k, k), LIGHT_HUD.w, LIGHT_HUD.h);
                }
            }
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
            const pages = pagesNow();
            if (page >= pages.length) page = 0;
            const want = pages[page] === 'Log';
            if (want !== logsOpen) { logsOpen = want; if (want) logs.open(); else logs.close(); }
            const th = ctx.theme();
            const cv = ctx.canvas(W, H).clear(th.bg);
            ({ Maps: drawMaps, Display: drawDisplay, Log: drawLog })[pages[page]](cv, th);
            G.frame(cv, th, pages.map((p) => t(p)), page, []);
            await ui.image('MAIN_GFX', cv);
        }

        ui.onClick('BTN_PAGE', () => { page = (page + 1) % pagesNow().length; changed(); });
        ctx.hideButton('BTN_PAGE');
        ctx.onTab((i) => { if (i !== page && i < pagesNow().length) { page = i; changed(); } });
        ctx.onLayout(changed);
        G.onConfirm(changed);
        ctx.loop('MAIN', 4, () => render(false));
        const redraw = () => { changed(); setTimeout(changed, 600); };
        ui.onVisible((name, on) => {
            if (name === 'MAIN' && on) { profiles.refresh(); redraw(); }
            if (name === 'MAIN' && !on && logsOpen) { logsOpen = false; logs.close(); }
        });
        render(true).catch((e) => log.warn('first render: ' + e));
    },
});

module.exports = { gearText, HUD_STATES };
