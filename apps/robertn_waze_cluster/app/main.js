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
const Engine = require('./kit/engine');
const revs = require('./revs.js');
const { withAlpha } = require('./kit/canvas');
const fonts = require('./kit/fonts');
const i18n = require('./i18n.js');
const { WazeClusterControl, HUD_SIZE_STEPS, ZOOM_STEP } = require('./waze_cluster_control.js');
const { LogsControl } = require('./logs_control.js');
const path = require('path');
const { HudOverlay, drawLight, LIGHT_HUD, anchorRect, mapRect, gearRect, arrowRect, dataRect, drawArrow, drawData, drawGear, HUD_W, HUD_H, ARROW, GREEN, SPEED_RECT } = require('./hud_overlay.js');
const { HvData } = require('./hv_data.js');
const { MoreData } = require('./more_data.js');
const { Diag } = require('./kit/diag');
const { TurnView, CAL: TV_CAL } = require('./turn_view.js');
const turnviewCamreq = require('./turnview_camreq.js');
const PANEL = require('./cluster_panel.js');
const { HudClaim } = require('./kit/hud_claim');
const { GreenLight } = require('./green_light.js');
const { Units } = require('./units.js');
const { TurnSignals } = require('./turn_signals.js');
const { ProfileSync, sessionReader } = require('./profile_sync.js');
const qrcodegen = require('./qrcodegen.js');
const icons = require('./icons.js');

const { t } = i18n;
const W = 1600, H = 520;
const PAGES = ['Maps', 'Display', 'Turn View', 'Log'];
/* The Display page's switches, its HUD tab's and its Cluster tab's: the setting, its words. */
const HUD_ITEMS = [['hudOn', 'Displays on HUD'], ['hudTurn', 'Turn signals'], ['hudGear', 'Gear'], ['realSpeed', 'Real speed on HUD'],
    ['greenLightHud', 'Green light alert'], ['hudNight', 'Dimmer at night'], ['hudWarn', 'Warnings take over']];
const CLUSTER_ITEMS = [['greenLightCluster', 'Green light alert'], ['clusterPanel', 'Info bar'], ['sideView', 'Side view']];
/* The icon in front of each switch (icons.js), by its setting. */
const ICON = { hudOn: 'hud', hudTurn: 'turn', hudGear: 'gear', realSpeed: 'speed', greenLightHud: 'light', hudNight: 'night', hudWarn: 'warn', hudKeep: 'layers',
    map: 'map', guide: 'guide', greenLightCluster: 'light', clusterPanel: 'bar', sideView: 'camera', own: 'person' };
/* Side view: the side signalled, its camera on the cluster (waze-on-cluster's Side view copy) while Turn View is off; kept SIDE_HOLD_MS after
 * the signal (its blink and a lane change's short taps). Hazards: nothing. */
const SIDE_HOLD_MS = 1500;
/* The pictures' traffic light in its loop of GO_DEMO_MS: red, then green with "GO" for the last GO_DEMO_ON. */
const GO_DEMO_MS = 4000, GO_DEMO_ON = 1500;
const demoLight = () => (Date.now() % GO_DEMO_MS < GO_DEMO_MS - GO_DEMO_ON ? { colour: 'red', go: false } : { colour: 'green', go: true });
/* The car's day / night enum (setting hudNight: the HUD map darker at night, waze_cluster_control nightDim). */
const DAY_NIGHT = { KEINE_AENDERUNG: 0, TAG: 1, NACHT: 2, SIGNAL_UNGUELTIG: 3 };
/* The part of the HUD's 800 x 480 scene the glass shows, about (a G21's, Redline's hud.js), with BMW's speed row. */
const HUD_GLASS = { x: 80, y: 100, w: 640, h: 290 };
/* The HUD's readings in the row under the map, up to HUD_DATA_MAX at once, in this order: the reading, its setting,
 * its words (hudData: the one reading an earlier version chose, taken over once). */
const HUD_DATA_MAX = 3;
/* Auto's choice held at least this long before a lower one takes over; a warning shown this long when it starts; what is
 * too hot, deg C (a low tyre: more_data.js lowTyre). */
const AUTO_HOLD_MS = 8000, WARN_SHOW_MS = 20000, HOT = { oil: 130, coolant: 115, gearbox: 120 };
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
    // petrol or diesel (kit/engine.js): the engine speed's scale and zones (revs.js)
    const engine = new Engine({ settings, dataDir: bg.dataDir, log });
    const car = new Car(Object.assign({}, bg, { log }), ['gear', 'speed', 'rpm', 'temps', 'torque'], {
        [Engine.SIGNAL[0]]: engine.handlers(),
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
    // the gearbox unit is asked over the diagnostic link (as M Vitals) only while the gearbox oil is shown and the car's
    // broadcast has none
    const diag = new Diag(bg.signals, log);
    diag.quiet = true; diag.busyLog = false;
    diag.init().catch((e) => log.warn('diagnostic link: ' + (e && e.message || e)));
    const more = new MoreData({ signals: bg.signals, log, diag }).start();
    // an earlier version's one reading (hudData) becomes its switch, once
    { const was = settings.get('hudData'), it = HUD_DATA.find(([v]) => v === was); if (it) { settings.set(it[1], true); settings.set('hudData', 'off'); } }
    /* The HUD's readings switched on that this car has (the battery's with eDrive), up to HUD_DATA_MAX. */
    const manualChoices = () => HUD_DATA.filter(([v, key]) => settings.get(key) && ((v !== 'ev' && v !== 'soc') || hv.installed()))
        .map(([v]) => v).slice(0, HUD_DATA_MAX);
    const dataChoices = () => (settings.get('hudAuto') === true ? autoChoices() : manualChoices());
    /* Auto (setting hudAuto): the readings for what the car is doing, the first that holds -
     *   revving (from the yellow zone): engine speed, and boost where the car gives it;
     *   oil or coolant under PANEL.COLD_C: oil and coolant;
     *   driving on the battery (eDrive, the engine stopped): the electric range;
     *   else the readings chosen by hand (none: nothing).
     * A choice higher in the list takes over at once; a lower one only after AUTO_HOLD_MS, so it doesn't flicker. */
    let autoNow = null, autoSince = 0;
    const AUTO_ORDER = ['rev', 'cold', 'ev', 'manual'];
    /* What Auto shows for (the HUD's info bar, setting hudAuto, and the cluster's, clusterAuto): one situation for both. */
    function autoPick() {
        const d = car.data(), real = d && !d.demo ? d : {}, now = Date.now();
        const st = G.isNum(real.rpm) ? revs.stage(real.rpm, revZones(real)) : 'white';
        const pick = st !== 'white' ? 'rev'
            : (G.isNum(real.oil) && real.oil < PANEL.COLD_C) || (G.isNum(real.coolant) && real.coolant < PANEL.COLD_C) ? 'cold'
            : hv.installed() && (!G.isNum(real.rpm) || real.rpm < 300) ? 'ev' : 'manual';
        if (autoNow === null || (pick !== autoNow && (AUTO_ORDER.indexOf(pick) < AUTO_ORDER.indexOf(autoNow) || now - autoSince >= AUTO_HOLD_MS))) {
            if (pick !== autoNow) { autoNow = pick; autoSince = now; }
        } else if (pick === autoNow) autoSince = now;
        return autoNow;
    }
    function autoChoices() {
        const a = autoPick();
        return a === 'rev' ? (G.isNum(boost) ? ['rpm', 'boost'] : ['rpm']) : a === 'cold' ? ['temps'] : a === 'ev' ? ['ev'] : manualChoices();
    }
    /* A warning takes the info bar over for WARN_SHOW_MS when it starts (a low tyre, oil, coolant or gearbox oil too hot),
     * with Auto or the owner's readings; it shows again if it clears and comes back. */
    const warnSeen = {};
    const warningNow = () => {
        const d = car.data(), real = d && !d.demo ? d : {}, now = Date.now(), out = [];
        const low = more.lowTyre(), p = more.tyres(), gb = more.gearbox();
        const on = {
            tyres: low.length ? { label: t('TYRES'), text: Math.min.apply(null, low.map((w) => p[w])).toFixed(1) + ' bar' } : null,
            oil: G.isNum(real.oil) && real.oil >= HOT.oil ? { label: t('OIL'), text: Math.round(real.oil) + '°' } : null,
            coolant: G.isNum(real.coolant) && real.coolant >= HOT.coolant ? { label: t('COOLANT'), text: Math.round(real.coolant) + '°' } : null,
            gearbox: G.isNum(gb) && gb >= HOT.gearbox ? { label: t('GEARBOX'), text: Math.round(gb) + '°' } : null,
        };
        Object.keys(on).forEach((k) => {
            if (!on[k]) { delete warnSeen[k]; return; }
            if (warnSeen[k] === undefined) { warnSeen[k] = now; log.info('HUD warning: ' + k + ' ' + on[k].text); }
            if (now - warnSeen[k] < WARN_SHOW_MS) out.push(Object.assign({ kind: 'value', warn: true }, on[k]));
        });
        return out;
    };
    /* The cluster's info bar (cluster_panel.js): the items switched on (the battery's only with eDrive; none of them:
     * oil, coolant and engine speed), while the Waze map shows on the cluster and setting clusterPanel is on. */
    const panelManual = () => {
        const on = PANEL_ITEMS.filter(([k, key]) => settings.get(key) && offers(k, hv, settings)).map(([k]) => k);
        return (on.length ? on : ['oil', 'coolant', 'rpm']).slice(0, PANEL_MAX);
    };
    // Auto (clusterAuto): the cluster's items for the same situation as the HUD's (autoPick), else the ones chosen
    const panelKinds = () => {
        if (settings.get('clusterAuto') !== true) return panelManual();
        const a = autoPick(), ok = (l) => l.filter((k) => offers(k, hv, settings));
        const l = a === 'rev' ? ok(G.isNum(boost) ? ['rpm', 'boost'] : ['rpm']) : a === 'cold' ? ok(['oil', 'coolant'])
            : a === 'ev' ? ok(['power', 'soc']) : [];
        return l.length ? l : panelManual();
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
    const revZones = (real) => revs.zones(engine.redline(), engine.value('coldLimit', { diesel: 3000, petrol: 4500 }), real.oil);
    // the engine speed's stage (revs.js): the gear and the slider red from the shift point, flashing near the redline
    const revStage = () => { const d = car.data(); return d && !d.demo && G.isNum(d.rpm) ? revs.stage(d.rpm, revZones(d)) : 'white'; };
    const gearHot = () => { const st = revStage(); return st === 'red' || (st === 'flash' && revs.flashOn(Date.now())); };
    const gearNow = () => { const d = car.data(); return d && !d.demo ? gearText(Object.assign({}, d, { program })) : null; };
    /* The data under the map (hud_overlay.js drawData), the car's own only; preview: every chosen one, '--' for
     * a value not known. */
    const dataNow = (preview) => {
        const warn = preview || settings.get('hudWarn') === false ? [] : warningNow();
        if (warn.length) return warn.slice(0, HUD_DATA_MAX);
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
                // white, yellow, red from the shift point; the red lower while the oil is cold (revs.js)
                slider(real.rpm, 0, engine.scaleMax(), G.isNum(real.rpm) ? Math.round(real.rpm / 10) * 10 : '', false,
                    G.isNum(real.rpm) ? revs.colour(revs.stage(real.rpm, revZones(real)), revs.flashOn(Date.now())) : null);
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
        turn: turns.state(), gear: gearNow(), gearHot: gearHot(), map: mapNow(),
        showTurn: !!settings.get('hudTurn'), showGear: !!settings.get('hudGear'), data: dataNow(false), speed: speedNow(),
    }));
    car.onSample(() => { toHud(); changed(); });
    // a flash, and a warning's end, need the HUD drawn again between the car's samples
    setInterval(() => { if (revStage() === 'flash' || Object.keys(warnSeen).length) toHud(); }, revs.FLASH_MS);
    hv.on('change', () => { toHud(); changed(); });
    more.on('change', () => { toHud(); toPanel(); changed(); });
    const gearWanted = () => more.wantGearbox((settings.get('hudOn') !== false && hudOk() && dataChoices().indexOf('gearbox') >= 0) ||
        (settings.get('clusterPanel') !== false && panelKinds().indexOf('gearbox') >= 0));
    gearWanted();
    settings.onChange(gearWanted);
    ctl.on('change', () => { toHud(); changed(); });
    // Turn View (IterioDev's, native/turn-view): its tool's switch and calibration, the front camera asked of the camera
    // unit (BMW's SDK on the car; none in a preview), the Waze map out of the cluster while it is on
    // BMW's SDK as the deploy tool makes it for this package: require('oap-sdk')'s someipBuilders (no inner paths)
    let sdk = null;
    try { sdk = require('oap-sdk').someipBuilders || null; } catch (e) { /* a preview: no camera request */ }
    if (!sdk) log.warn('turn view: no SOME/IP builders: the front camera is not asked for');
    const tvLog = (...a) => log.info('turn view: ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    const tv = new TurnView({ log, ctl, hudOk, store: settings, camreq: sdk ? turnviewCamreq.create({ someipBuilders: sdk, log: tvLog }) : null }).start();
    tv.on('change', changed);
    ctl.on('change', () => tv.mapChanged());
    logs.on('change', changed);
    profiles.on('change', changed);
    // Turn View shows while a turn signal is on (or the turn is near): the tool is told
    let sideTimer = null;
    function sideNow() {
        const st = turns.state(), on = settings.get('sideView') === true && !tv.enabled();
        const s = on && st.left && !st.right ? 'left' : on && st.right && !st.left ? 'right' : null;
        // the camera copy shown only while the ECU shows the side asked for (no mosaic or front view in between)
        const shown = () => !!tv.sideNow && (!tv.cam || tv.cam.sideOn());
        if (s || !on) { clearTimeout(sideTimer); sideTimer = null; tv.side(s); ctl.showSide(shown()); return; }
        ctl.showSide(shown());
        if (tv.sideNow && !sideTimer) sideTimer = setTimeout(() => { sideTimer = null; tv.side(null); ctl.showSide(false); }, SIDE_HOLD_MS);
    }
    turns.on('change', () => { toHud(); const st = turns.state(); if (typeof tv !== 'undefined' && tv) { tv.signal(!!(st.left || st.right)); sideNow(); } changed(); });
    tv.on('change', sideNow);
    settings.onChange(() => { hvWanted(); claims(); toHud(); toPanel(); dimNow(); sideNow(); changed(); });
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
    // the light the car waits at: red while it stands, green with "GO" and the gong; on the cluster, and on the HUD while
    // ours is shown there
    const green = new GreenLight({ signals: bg.signals, log, speed: () => { const d = car.data(); return d && !d.demo ? d.speed : null; } });
    green.on('show', (s) => {
        hud.go(s, settings.get('greenLightHud') !== false && hudOk() && settings.get('hudOn') !== false && !given(),
            settings.get('greenLightCluster') !== false);
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
    return { tv, ctl, logs, turns, hud, hv, profiles, car, lines, log, mapNow, gearNow, dataNow, dataChoices, hudOk, green, panelKinds, panelItems, onChange: (fn) => listeners.push(fn) };
}

mgu.run({
    background,

    async start(ctx) {
        const { ui, settings } = ctx;
        const b = ctx.background || await background(ctx);
        const { tv, ctl, logs, turns, hud, hv, profiles, car, lines, log, mapNow, gearNow, dataNow, dataChoices, hudOk, green, panelKinds, panelItems } = b;
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
        // a switch slides between off and on in SLIDE_MS (slid: key -> { on, at }), the page drawn again meanwhile
        const SLIDE_MS = 160, slid = new Map();
        const slide = (key, on) => {
            const s = slid.get(key), now = Date.now();
            if (!s) { slid.set(key, { on, at: 0 }); return on ? 1 : 0; }
            if (s.on !== on) { s.on = on; s.at = now; for (let i = 1; i <= 5; i++) setTimeout(changed, i * SLIDE_MS / 4); }
            const f = Math.min(1, (now - s.at) / SLIDE_MS), e = 1 - Math.pow(1 - f, 3);
            return on ? e : 1 - e;
        };
        const toggle = (cv, th, x, y, on, run, key, off) => {
            const S = th.sel || th.accent, p = slide(key, !!on);
            cv.roundRect(x, y, 56, 30, 15, withAlpha('#ffffff', off ? 0.08 : 0.2));
            if (p > 0) cv.roundRect(x, y, 56, 30, 15, withAlpha(S, (off ? 0.4 : 1) * p));
            cv.circle(x + 15 + 26 * p, y + 15, 11, off ? withAlpha('#ffffff', 0.4) : p > 0.5 ? G.onColour(S) : '#d6d7da');
            if (!off && cv.own) cv.target(x - 8, y - 10, 72, 50, run, key, 19);
        };
        /* A switch's row, w wide from x, h high from y: its icon, its words (a smaller second line under them: note
         * { text, color }), the switch on the right and a thin line under the row. */
        const switchRow = (cv, th, x, y, w, h, icon, text, on, run, key, off, note) => {
            icons.draw(cv, icon, x + 14, y + h / 2, off ? withAlpha(th.dim, 0.6) : th.dim);
            const tx = x + 42, tw = w - 42 - 72;
            if (note) {
                cv.text(fit(cv, text, 22, tw, 'label'), tx, y + h / 2 - 2, 22, off ? th.dim : th.text, { font: 'label' });
                cv.text(fit(cv, note.text, 15, tw, 'label'), tx, y + h / 2 + 17, 15, note.color, { font: 'label' });
            } else cv.text(fit(cv, text, 22, tw, 'label'), tx, y + h / 2 + 8, 22, off ? th.dim : th.text, { font: 'label' });
            toggle(cv, th, x + w - 56, y + (h - 30) / 2, on, run, key, off);
            cv.fillRect(x, y + h - 1, w, 1, withAlpha('#ffffff', 0.08));
        };
        /* A section's heading: its words in capitals; returns the x after them. */
        const heading = (cv, th, s, x, y) => {
            const s2 = String(s).toUpperCase(), opt = { font: 'bold', spacing: 2.5 };
            cv.roundRect(x, y - 14, 4, 16, 2, th.sel || th.accent);
            cv.text(s2, x + 12, y, 17, th.dim, opt);
            return x + 12 + cv.textWidth(s2, 17, opt);
        };
        /* How many of the most are on: a short line each, the ones on in the theme's colour, then "n/max". */
        const countLines = (cv, th, x, y, n, max) => {
            for (let i = 0; i < max; i++) cv.roundRect(x + i * 19, y - 7, 15, 3, 1.5, i < n ? th.sel || th.accent : withAlpha('#ffffff', 0.2));
            const tx = x + max * 19 + 6;
            cv.text(n + '/' + max, tx, y, 17, th.dim, { font: 'label' });
            return tx + cv.textWidth(n + '/' + max, 17, { font: 'label' });
        };
        /* Auto as a small switch in a pill, its words after it; returns the x after them. */
        const autoPill = (cv, th, x, y, on, run, key, off, words) => {
            const S = th.sel || th.accent, opt = { font: 'bold', spacing: 1.5 }, label = t('Auto').toUpperCase();
            const lw = cv.textWidth(label, 14, opt), w = lw + 30 + 46;
            if (cv.own) {
                cv.roundRect(x, y - 16, w, 32, 16, withAlpha('#ffffff', 0.09));
                cv.strokeRoundRect(x, y - 16, w, 32, 16, 1.5, on && !off ? S : withAlpha('#ffffff', 0.2));
                cv.text(label, x + 14, y + 5, 14, off ? th.dim : th.text, opt);
                const sx = x + w - 46;
                cv.roundRect(sx, y - 11, 40, 22, 11, on ? withAlpha(S, off ? 0.4 : 1) : withAlpha('#ffffff', off ? 0.08 : 0.2));
                cv.circle(on ? sx + 29 : sx + 11, y, 8, off ? withAlpha('#ffffff', 0.4) : on ? G.onColour(S) : '#d6d7da');
                if (!off) cv.target(x, y - 20, w, 40, run, key);
            }
            if (words) cv.text(fit(cv, words, 15, DL - (x + w + 14), 'label'), x + w + 14, y + 5, 15, th.dim, { font: 'label' });
            return x + w;
        };
        /* The pictures' map, in x, y, w, h: dark ground, grey roads, the route in the theme's second colour and the car's arrow;
         * a(alpha) dims it (the HUD's brightness). */
        const drawMap = (cv, th, x, y, w, h, a) => {
            cv.roundRect(x, y, w, h, 8, withAlpha('#0d1014', a(1)));
            const road = (x0, y0, x1, y1, lw, c) => cv.line(x + x0 * w, y + y0 * h, x + x1 * w, y + y1 * h, lw, withAlpha(c, a(1)));
            const s = Math.max(1, Math.min(w, h) / 60);
            [[0, 0.2, 1, 0.33, 3], [0, 0.74, 1, 0.6, 3], [0.23, 0, 0.32, 1, 3], [0.77, 0, 0.63, 1, 3]].forEach(([x0, y0, x1, y1, lw]) => road(x0, y0, x1, y1, lw * s, '#2b2f36'));
            road(0, 0.48, 1, 0.52, 5 * s, '#3a3f47');
            road(0.5, 0, 0.47, 1, 5 * s, '#3a3f47');
            cv.polyline([[x + 0.48 * w, y + h * 0.98], [x + 0.49 * w, y + h * 0.5], [x + 0.72 * w, y + h * 0.33]], 4 * s, withAlpha(th.accent2 || '#81c4ff', a(1)));
            cv.quad([[x + 0.48 * w, y + h * 0.8], [x + 0.48 * w - 4 * s, y + h * 0.8 + 9 * s], [x + 0.48 * w + 4 * s, y + h * 0.8 + 9 * s], [x + 0.48 * w, y + h * 0.8]], withAlpha('#ffffff', a(1)));
        };
        /* A picture's screen: dark, a little lighter at the top, with a soft edge. */
        const screen = (cv, x, y, w, h, sel) => {
            cv.card(x, y, w, h, 12, [[0, '#14171d'], [0.55, '#07090c'], [1, '#040506']]);
            cv.strokeRoundRect(x, y, w, h, 12, 1, withAlpha('#ffffff', 0.06));
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
                return hh;
            }
            const off = ctx.canvas(ww, hh).clear('#05070a');
            off.glass = true; off.own = cv.own;
            drawHudPicture(off, th, 0, 0, ww, crop);
            cv.blit(off, Math.round(x0), Math.round(y0));
            return hh;
        };
        const drawHudPicture = (cv, th, x0, y0, w, crop) => {
            const c = crop || { x: 0, y: 0, w: HUD_W, h: HUD_H }, k = w / c.w, h = c.h * k;
            screen(cv, x0, y0, w, h);
            const x = x0 - c.x * k, y = y0 - c.y * k;
            const m = mapNow(), mx = x + m.x * k, my = y + m.y * k, mw = m.w * k, mh = m.h * k;
            const on = ctl.hudOn() === true, br = (ctl.hudBrightness() || 100) / 100;
            const a = (v) => (on ? v * (0.25 + 0.75 * br) : v * 0.25);
            drawMap(cv, th, mx, my, mw, mh, a);
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
            const ex = G.pageBottom(cv) - G.BOTTOM, S = th.sel || th.accent;
            G.panel(cv, th, 24, 44, 760, 468, t('Map'));
            heading(cv, th, t('Show on'), 48, 120);
            const on = ctl.shownOn(), can = ctl.canChooseShownOn();
            G.segment(cv, th, 48, 132, 712, 48, [['cluster', 'Cluster'], ['hud', 'HUD'], ['both', 'Cluster + HUD']].filter(([v]) => v === 'cluster' || hudOk())
                .map(([v, text]) => ({ label: t(text), run: () => ctl.showOn(v), on: on === v, busy: !can, key: 'show-' + v })));
            const statusPill = (s, x, col) => {
                const opt = { font: 'bold', spacing: 1 }, s2 = String(s).toUpperCase(), w = cv.textWidth(s2, 13, opt) + 34;
                cv.roundRect(x, 190, w, 26, 13, withAlpha(col, 0.16));
                cv.circle(x + 13, 203, 4, col);
                cv.text(s2, x + 24, 208, 13, col, opt);
                return x + w + 10;
            };
            const shows = (st) => st !== t('Off') && st !== t('Unavailable');
            const px2 = statusPill(ctl.mapText(), 48, shows(ctl._mapState()) ? '#25e05a' : th.dim);
            if (hudOk()) statusPill(ctl.hudText(), px2, ctl.hudDisabled() ? th.warn : shows(ctl._hudState()) ? '#25e05a' : th.dim);
            // the map settings of this driver profile, its own or the shared ones (greyed while no profile is known)
            // (BMW's logo on the cluster: the Display page, Cluster)
            const po = profiles.canChooseOwn();
            switchRow(cv, th, 48, 224, 712, 46, ICON.own, t('Own settings for this driver'), profiles.ownShown(), () => profiles.setOwn(!profiles.ownShown()), 'profile-own', !po);

            // the phones: a row each with its patch's state (a tap picks it), under them the picked one's details and buttons
            const py = 300 + ex / 4;
            heading(cv, th, t('Phone maps'), 48, py);
            const ps = ctl.patchStatus, aa = ctl.aa();
            [['carplay', 'CarPlay', ctl._carplayState(), ps && ps.state, ctl.pending()], ['aa', 'Android Auto', ctl._aaState(), aa && aa.state, aa && aa.pending]]
                .forEach(([v, name, state, st, pending], i) => {
                    const ry = py + 12 + i * 44, picked = phone === v;
                    if (picked) {
                        cv.roundRect(48, ry + 2, 712, 40, 8, withAlpha(S, 0.12));
                        cv.roundRect(48, ry + 8, 3, 28, 1.5, S);
                    }
                    const dot = pending ? th.warn : st === 'patched' ? '#25e05a' : withAlpha('#ffffff', 0.3);
                    cv.circle(66, ry + 22, 5, dot);
                    cv.text(name, 84, ry + 30, 22, th.text, { font: 'label' });
                    const sopt = { font: 'bold', spacing: 1 }, stxt = fit(cv, String(state).toUpperCase(), 13, 440, 'bold'), sw = cv.textWidth(stxt, 13, sopt) + 20;
                    cv.roundRect(752 - sw, ry + 10, sw, 24, 8, withAlpha('#ffffff', 0.08));
                    cv.text(stxt, 752 - sw / 2, ry + 27, 13, th.text, { font: 'bold', spacing: 1, align: 'center' });
                    if (i === 0) cv.fillRect(48, ry + 43, 712, 1, withAlpha('#ffffff', 0.08));
                    if (cv.own) cv.target(48, ry, 712, 44, () => { phone = v; changed(); }, 'phone-' + v);
                });
            const cp = phone === 'carplay';
            // why the patch cannot be applied (patchd's own words), else the Wi-Fi band or the zoom, and the restart's
            const why = ctl.conflictDetail(!cp).replace(/^not supported on this car \((.*)\)$/, '$1');
            const dy = py + 126;
            small(cv, th, [why || (cp ? ctl.wifiText() : ctl.zoomText()), ctl.restartText()].filter(Boolean).join('  ·  '), 48, dy, cp ? 712 : 230, why ? th.warn : th.dim);
            if (!cp) {
                G.button(cv, th, 286, dy - 26, 44, 36, '-', () => ctl.zoom(-ZOOM_STEP), { busy: !ctl.canZoom(-ZOOM_STEP), key: 'zoom-', glyph: 'minus', round: true });
                G.button(cv, th, 338, dy - 26, 44, 36, '+', () => ctl.zoom(ZOOM_STEP), { busy: !ctl.canZoom(ZOOM_STEP), key: 'zoom+', glyph: 'plus', round: true });
                cv.text(fit(cv, ctl.cardText(), 19, 290, 'label'), 400, dy, 19, ctl.canToggleCard() ? th.text : th.dim, { font: 'label' });
                toggle(cv, th, 704, dy - 22, ctl.cardHidden(), () => ctl.toggleCard(), 'card', !ctl.canToggleCard());
            }
            let bx = 48;
            const by = dy + 20;
            const btn = (text, run, opts) => { bx += G.button(cv, th, bx, by, 0, 44, text, run, opts) + 10; };
            if (ctl.restartNeeded() || ctl.restartOffered()) {
                btn(t('Restart head unit'), () => ctl.requestRestart(), { confirm: true, primary: ctl.canRestart(), busy: !ctl.canRestart(), key: 'restart' });
            }
            if (cp) {
                if (ctl.reinstallWanted()) btn(t('Reinstall patch'), () => ctl.reinstallMap(), { primary: true, busy: !ctl.canReinstall(), key: 'cp-reinstall' });
                else btn(t('Patch'), () => ctl.enableMap(), { primary: ctl.canEnable(), busy: !ctl.canEnable(), key: 'cp-patch' });
                btn(t('Remove patch'), () => ctl.disableMap(), { confirm: true, busy: !ctl.canDisable(), key: 'cp-unpatch' });
            } else {
                btn(t('Patch'), () => ctl.enableAa(), { primary: ctl.canEnableAa(), busy: !ctl.canEnableAa(), key: 'aa-patch' });
                btn(t('Remove patch'), () => ctl.disableAa(), { confirm: true, busy: !ctl.canDisableAa(), key: 'aa-unpatch' });
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
                G.button(cv, th, 1408, y + 6, 60, 48, '-', minus, { busy: !canMinus, key: key + '-', glyph: 'minus', round: true });
                G.button(cv, th, 1480, y + 6, 60, 48, '+', plus, { busy: !canPlus, key: key + '+', glyph: 'plus', round: true });
            };
            const w = ctl.hudWidth();
            row(128, t('Size'), w == null ? '--' : w === 0 ? t('Standard') : t('{0} %', w), () => ctl.setHudSizeStep(step - 1),
                () => ctl.setHudSizeStep(step + 1), can2 && step > 0, can2 && step !== null && step < HUD_SIZE_STEPS, 'size');
            const br = ctl.hudBrightness();
            row(218, t('Brightness'), br == null ? '--' : t('{0} %', br), () => ctl.stepHudBrightness(-1), () => ctl.stepHudBrightness(1),
                ctl.canChangeHudBrightness(-1), ctl.canChangeHudBrightness(1), 'bright');
            label(cv, th, t('Position'), 1256, 308);
            [['up', 1376, 320, '^'], ['left', 1304, 376, '<'], ['right', 1448, 376, '>'], ['down', 1376, 432, 'v']].forEach(([dir, px, py, glyph]) =>
                G.button(cv, th, px, py, 60, 48, glyph, () => ctl.moveHud(dir), { busy: !can2, key: 'move-' + dir, glyph: dir, round: true }));
            G.button(cv, th, 1376, 376, 60, 48, 'o', () => ctl.centreHud(), { busy: !ctl.canCentreHud(), key: 'centre', glyph: 'centre', round: true });
        }

        /* A picture of the cluster: its two dials, the map in the middle while it shows there, "GO" over it. */
        const clusterPicture = (cv, th, x, y, w, go) => {
            const h = Math.round(w * 720 / 1920), r = Math.min(h * 0.4, w * 0.13);
            screen(cv, x, y, w, h);
            [x + w * 0.16, x + w * 0.84].forEach((cx) => {
                cv.arc(cx, y + h * 0.55, r - 4, r, -130, 130, withAlpha('#ffffff', 0.35));
                const ang = (blink ? -40 : 25) * Math.PI / 180;      // the needle swings with the blink
                cv.line(cx, y + h * 0.55, cx + r * 0.6 * Math.sin(ang), y + h * 0.55 - r * 0.6 * Math.cos(ang), 3, th.sel || th.accent);
            });
            const mx = x + w * 0.33, my = y + h * 0.18, mw = w * 0.34, mh = h * 0.64;
            if (ctl.clusterOn() === true) drawMap(cv, th, mx, my, mw, mh, (v) => v);
            else cv.strokeRoundRect(mx, my, mw, mh, 8, 1, withAlpha('#ffffff', 0.15));
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
                // small, at the top of the middle (hud_overlay LIGHT_CLUSTER), "GO" under it
                const lh = mh * 0.4, lw = lh * 0.375;
                drawLight(scaled(cv, mx + (mw - lw) / 2, my + mh * 0.04, 1), lw, lh, go);
            }
            return h;
        };
        /* cv's drawing moved to x, y and scaled by k, for hud_overlay's drawLight. */
        const scaled = (cv, x, y, k) => ({
            roundRect: (a, b, w, h, rr, c) => cv.roundRect(x + a * k, y + b * k, w * k, h * k, rr * k, c),
            strokeRoundRect: (a, b, w, h, rr, lw, c) => cv.strokeRoundRect(x + a * k, y + b * k, w * k, h * k, rr * k, lw, c),
            circle: (a, b, rr, c) => cv.circle(x + a * k, y + b * k, rr * k, c),
            text: (s, a, b, sz, c, o) => cv.text(s, x + a * k, y + b * k, sz * k, c, o),
        });
        /* The Display page: the switches and the info bar's choices on the left (DL wide), the pictures on the right. */
        const DL = 1056, DCOL = 524, DCOLS = 4, DBTN = 243, DTOP = 120, DROW = 44, DCHIP = 44, DCHIP_STEP = 52;
        function drawDisplay(cv, th) {
            const hasHud = hudOk();
            if (!hasHud) dispTab = 'cluster';
            const goNow = demoLight();

            // the switches on the left: a tab for the HUD, one for the cluster
            G.panel(cv, th, 24, 44, DL, 468, null);
            G.segment(cv, th, 48, 58, DL - 48, 54, (hasHud ? [['cluster', 'Cluster'], ['hud', 'HUD']] : [['cluster', 'Cluster']])
                .map(([id, text]) => ({ label: t(text), run: () => { dispTab = id; changed(); }, on: dispTab === id, key: 'tab-' + id })));
            // two columns of switches, DROW high; note: a smaller second line under the words (the green light alert's camera)
            const row = (i, key, text, on, run, off, note) =>
                switchRow(cv, th, 48 + (i % 2) * DCOL, DTOP + Math.floor(i / 2) * DROW, DCOL - 40, DROW, ICON[key], text, on, run, 'disp-' + key, off, note);
            const flip = (key) => () => settings.set(key, settings.get(key) === false ? true : !settings.get(key));
            // under the green light alert's label: whether the car's traffic-light camera answers
            const camera = (key) => {
                const f = /^greenLight/.test(key) ? green.found() : null;
                return f === null ? null : { text: f ? t('Traffic-light camera found') : t('Traffic-light camera not found'), color: f ? th.dim : th.warn };
            };
            // the readings to pick, DCOLS a row from y: a chip each, numbered in the order they show
            const chips = (y, items, prefix, max, off) => {
                const picked = items.filter(([, key]) => settings.get(key));
                items.forEach(([v, key, text], i) => {
                    const lit = !!settings.get(key), n = lit ? picked.findIndex(([v2]) => v2 === v) + 1 : 0;
                    G.chip(cv, th, 48 + (i % DCOLS) * (DBTN + 12), y + Math.floor(i / DCOLS) * DCHIP_STEP, DBTN, DCHIP, t(text), n, () => settings.set(key, !lit),
                        { key: prefix + v, busy: off || (!lit && picked.length >= max) });
                });
                return picked.length;
            };
            if (dispTab === 'hud') {
                const hudOnNow = settings.get('hudOn') !== false;
                HUD_ITEMS.forEach(([key, text], i) => row(i, key, t(text), settings.get(key) !== false && !!settings.get(key), flip(key), key !== 'hudOn' && !hudOnNow, camera(key)));
                // BMW's HUD pop-ups (calls, media, lists): the map gives way to them, or stays over them
                row(HUD_ITEMS.length, 'hudKeep', t("Keep HUD map over BMW's pop-ups"), ctl.hudKeepShown() === true, () => ctl.toggleHudKeep(), !hudOnNow || !ctl.canKeepHud());
                // the readings, as the info bar's: a chip each, lit while on (up to HUD_DATA_MAX)
                const offered = HUD_DATA.filter(([v]) => (v !== 'ev' && v !== 'soc') || hv.installed());
                const hy = DTOP + Math.ceil((HUD_ITEMS.length + 1) / 2) * DROW + 32;
                const count = offered.filter(([, key]) => settings.get(key)).length;
                // Auto: the readings for what the car is doing; the ones chosen by hand otherwise
                const auto = settings.get('hudAuto') === true;
                let hx = heading(cv, th, t('Info bar'), 48, hy) + 16;
                hx = countLines(cv, th, hx, hy, Math.min(count, HUD_DATA_MAX), HUD_DATA_MAX) + 18;
                autoPill(cv, th, hx, hy - 6, auto, () => settings.set('hudAuto', !auto), 'data-auto', !hudOnNow, t('Revving: engine speed, boost | When cold: oil, coolant | Electric: range'));
                chips(hy + 18, offered, 'data-', HUD_DATA_MAX, !hudOnNow);
            } else {
                // the map on the cluster: on or off with the HUD's as it is (never on neither)
                const shown = ctl.shownOn(), clusterNow = ctl.clusterOn() === true, hudMap = ctl.hudOn() === true;
                const canMap = ctl.canChooseShownOn() && (!clusterNow || hudMap);
                row(0, 'map', t('Map'), clusterNow, () => ctl.showOn(clusterNow ? 'hud' : hudMap ? 'both' : 'cluster'), !canMap || shown === null && !ctl.canChooseShownOn());
                const gu = ctl.guidanceUnavailable(), hide = ctl.hideGuidance();
                row(1, 'guide', t('Hide logo on the cluster'), !!hide, () => ctl.toggleGuidance(), gu || hide === null);
                // the info bar shows under the map: off while the map is not on the cluster
                const noBar = (key) => key === 'clusterPanel' && !clusterNow;
                // Side view: off (and saying why) while Turn View is on, or without waze-on-cluster's Side view camera
                const sideOff = (key) => key === 'sideView' && (tv.enabled() || !ctl.sideReady());
                const sideNote = (key) => (key !== 'sideView' ? null : !ctl.sideReady() ? { text: t('Update Waze on cluster'), color: th.dim }
                    : tv.enabled() ? { text: t('Off while Turn View is on'), color: th.dim } : null);
                CLUSTER_ITEMS.forEach(([key, text], i) => row(2 + i, key, t(text), (key === 'sideView' ? settings.get(key) === true && !tv.enabled() : settings.get(key) !== false) && !noBar(key),
                    flip(key), noBar(key) || sideOff(key), camera(key) || sideNote(key)));
                // the info bar's items, as the HUD's reading: a chip each, lit while on (up to PANEL_MAX)
                const barOn = settings.get('clusterPanel') !== false && clusterNow;
                const offered = PANEL_ITEMS.filter(([k]) => offers(k, hv, settings));
                const count = offered.filter(([, key]) => settings.get(key)).length;
                const ly = DTOP + Math.ceil((2 + CLUSTER_ITEMS.length) / 2) * DROW + 32;
                // Auto: the items for what the car is doing (as the HUD's); the ones chosen by hand otherwise
                const cauto = settings.get('clusterAuto') === true;
                let lx = heading(cv, th, t('Info bar'), 48, ly) + 16;
                lx = countLines(cv, th, lx, ly, Math.min(count, PANEL_MAX), PANEL_MAX) + 18;
                autoPill(cv, th, lx, ly - 6, cauto, () => settings.set('clusterAuto', !cauto), 'item-auto', !barOn, t('Revving: engine speed, boost | When cold: oil, coolant | Electric: kW, charge'));
                chips(ly + 18, offered, 'item-', PANEL_MAX, !barOn);
            }

            // the pictures on the right: the cluster on top, the HUD under it, each showing what of ours is on there
            const px = 24 + DL + 20, pw = 1576 - px;
            G.panel(cv, th, px, 44, pw, 468, t('Display'));
            const cw = pw - 40, cx = px + 20;
            const ch = clusterPicture(cv, th, cx, hasHud ? 96 : 150, cw, settings.get('greenLightCluster') !== false ? goNow : null);
            if (hasHud) {
                // as wide as the cluster: the part of the HUD's scene the glass shows (HUD_GLASS)
                const hw = cw, hx = cx, hy = 96 + ch + 12, hudOnNow = settings.get('hudOn') !== false;
                demoTurns = true;
                hudPicture(cv, th, hx, hy, hw, HUD_GLASS);
                demoTurns = false;
                if (hudOnNow && settings.get('greenLightHud') !== false) {
                    const k = hw / HUD_GLASS.w, a = anchorRect(mapNow());
                    drawLight(scaled(cv, hx + (a.x - HUD_GLASS.x + (a.w - LIGHT_HUD.w) / 2) * k, hy + (a.y - HUD_GLASS.y + 4) * k, k), LIGHT_HUD.w, LIGHT_HUD.h, goNow);
                }
            }
        }

        /* Turn View (IterioDev's): on / off and what the tool says on the left, its calibration on the right. Words in
         * English in every language. */
        const TV_CAMERA = { decoding: ['Front camera', 'ok'], waiting: ['Waiting for the camera', ''], idle: ['Waiting for Map view', ''],
            stalled: ['Camera busy', 'warn'], refused: ['Cluster video full', 'crit'], off: ['Off', ''], restarting: ['Camera tool restarting', 'warn'],
            missing: ['Camera tool missing', 'crit'] };
        const TV_ROUTE = { none: 'No route', active: 'Active', recalculating: 'Recalculating' };
        function drawTurnView(cv, th) {
            const st = tv.state, s = st && st.status, on = tv.enabled();
            const col = (k) => (k === 'ok' ? th.ok || th.text : k === 'warn' ? th.warn : k === 'crit' ? th.crit || th.warn : th.text);
            G.panel(cv, th, 24, 44, 900, 468, 'Turn View');
            // the switch: one button, lit while Turn View is on
            G.button(cv, th, 48, 106, 296, 52, on ? 'Turn View: On' : 'Turn View: Off', () => tv.enable(!on),
                { primary: on, key: 'tv-on', busy: !st });
            // when it shows in Map view
            G.segment(cv, th, 364, 108, 340, 48, [['near', 'Near a turn'], ['always', 'Always']]
                .map(([v, text]) => ({ label: text, run: () => tv.setShow(v), on: tv.show() === v, busy: !st, key: 'tv-show-' + v })));
            if (!st) {
                small(cv, th, 'The Turn View tool is not running: install Turn View in the Store (Head-unit tools), then restart the head unit.', 48, 190, 850, th.warn);
            } else {
                const cam = s && s.state === 'off' && !on ? ['Off', ''] : (s && TV_CAMERA[s.camera]) || [(s && s.camera) || '--', ''];
                const nav = s && s.nav === 'no navigation data' ? ['No guidance: is navigation on?', 'warn'] : [(s && TV_ROUTE[s.route]) || (s && s.route) || '--', s && s.route === 'active' ? 'ok' : ''];
                const m = s && s.maneuver;
                const cs = tv.camStatus();
                [['Camera', cam], ['Route', nav], ['Navigation from', [(s && s.provider) || '--', '']],
                    ['Next turn', [m ? m.text + ' · ' + m.kind + (m.exit ? ' · exit ' + m.exit : '') : s && s.route === 'active' ? 'None ahead' : '--', '']],
                    ['Camera request', [cs.text.charAt(0).toUpperCase() + cs.text.slice(1), cs.state === 'on' ? 'ok' : cs.state === 'refused' || cs.state === 'rearonly' ? 'crit' : '']],
                ].forEach(([k, v], i) => {
                    small(cv, th, k, 48, 196 + i * 40 + 12, 240, th.dim);
                    small(cv, th, v[0], 300, 196 + i * 40 + 12, 600, col(v[1]));
                });
                small(cv, th, 'Stays as you left it at the next start. Instrument cluster > Central display area: Map view.', 48, 420, 850, th.dim);
                small(cv, th, on ? (hudOk() ? 'While it is on, the Waze map is on the HUD only.' : 'While it is on, the Waze map is off.')
                    : (hudOk() ? 'Switched on, it moves the Waze map to the HUD; off, the map comes back.' : 'Switched on, it turns the Waze map off; off, the map comes back.'), 48, 452, 850, th.dim);
            }
            small(cv, th, 'Turn View by IterioDev', 48, 492, 400, th.dim);

            G.panel(cv, th, 944, 44, 632, 468, 'Calibrate');
            if (!tv.calibrating) {
                small(cv, th, 'Marks at 5, 10 and 20 m show on the camera: move them onto the road.', 968, 128, 590, th.dim);
                G.button(cv, th, 968, 160, 260, 48, 'Calibrate', () => tv.calib(true), { primary: true, key: 'tv-calib', busy: !st });
                return;
            }
            const d = tv.draft || {};
            Object.keys(TV_CAL).forEach((k, i) => {
                const c = TV_CAL[k], y = 104 + i * 62, v = typeof d[k] === 'number' ? d[k].toFixed(c.decimals) + c.unit : '--';
                small(cv, th, c.label, 968, y + 30, 260, th.text);
                small(cv, th, v, 1236, y + 30, 120, th.text);
                G.button(cv, th, 1380, y, 80, 44, '-', () => tv.nudge(k, -1), { key: 'tv-' + k + '-', glyph: 'minus', round: true });
                G.button(cv, th, 1472, y, 80, 44, '+', () => tv.nudge(k, 1), { key: 'tv-' + k + '+', glyph: 'plus', round: true });
            });
            G.button(cv, th, 968, 424, 170, 48, tv.saved ? 'Saved' : 'Save', () => tv.save(), { primary: !tv.saved, key: 'tv-save' });
            G.button(cv, th, 1150, 424, 170, 48, 'Reset', () => tv.reset(), { key: 'tv-reset', confirm: true });
            G.button(cv, th, 1332, 424, 220, 48, 'Done', () => tv.calib(false), { key: 'tv-done' });
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
            // the calibration marks only while its page is open
            if (pages[page] !== 'Turn View' && tv.calibrating) tv.calib(false);
            const want = pages[page] === 'Log';
            if (want !== logsOpen) { logsOpen = want; if (want) logs.open(); else logs.close(); }
            const th = ctx.theme();
            const cv = ctx.canvas(W, H).clear(th.bg);
            ({ Maps: drawMaps, Display: drawDisplay, 'Turn View': drawTurnView, Log: drawLog })[pages[page]](cv, th);
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
