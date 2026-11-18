// Turn View's camera request: IterioDev's (github.com/IterioDev/car-apps, the Turn View app iteriodev_turnview 1.5.0,
// src/camreq.js), PolyForm Strict License 1.0.0, in Cluster functions with IterioDev's permission (native/turn-view/
// PERMISSION.md). Changed for Cluster functions: the showing file read every 0.5 s, the ECU's state read at once when
// a period starts; side() asks a side camera alone for Side view; a DR view that holds the front camera (WITH_FRONT,
// Drive recorder's all cameras) counts as on at once, so Turn View never asks it away.
'use strict';
/*
 * Turn View: the front camera asked of the camera ECU while the cluster widget shows it and no other app asks
 * (spec docs/superpowers/specs/2026-11-06-turn-view-design.md 4.3). The camera functions of Drive Recorder's
 * recorder.js (connect, named, camCall, attach, camRequest, camCheck, camRelease) with the same behaviour:
 *
 * mgu-camcluster writes the camera the widget shows ("front") to /dev/shm/camcluster/showing every 5 s while it
 * decodes; read here every 0.5 s, fresh = written less than 15 s ago and "front". A period starts when it turns fresh:
 * state 'waiting', the ECU's state read at once (XView3D CurrentState, else ICAM2Proxy currentState). DR_ACTIVE
 * with perspective 1 -> 'on' (asked by us when attached, else by another app: Drive Recorder in its DR mode asks
 * itself), read again every 5 s while fresh. Not applied -> attached as icam2proxy's indirect client (once) and
 * DR_ACTIVE / MODE_MOSAIK / 1 asked, read back 5 s later ('asked'), at most 3 tries a period. Both states are read
 * (1.1.1: either one showing the front view counts). Not given 3 times, the ECU ready and in no parking view: the
 * FALLBACK views asked once each - 5 (front + rear) and 7 (all cameras) also show the front camera (camcluster takes
 * it from their frames: 'on'), 2 (the rear camera alone) is the only proof of a car without a front camera: the ECU
 * gives it when we ask it (and did not before) -> 'rearonly' (user 2026-11-12: the widget then says "No front camera"
 * and nothing else), the camera given back at once. Anything else -> 'refused' with the ECU's state in the text (the
 * ECU still starting, a parking view, no camera service, no view given). 1.1.0 said 'nofront' when the front view
 * did not come or the service was missing: wrong on a BMW XM with cameras (2026-11-12). No more asks until the file
 * goes and comes again (still read: another app may get it on). A parking view taking the cameras shows as
 * camcluster's `video stalled`, the try cap keeps us from fighting it. Not fresh for 15 s (or the file missing): the
 * period ends, attached -> clientDetach ('released', then 'idle'). release() (app shutdown): clientDetach when
 * attached.
 *
 *   const cam = create({ someipBuilders, log, showingFile?, now?, setTimer? });   (the last three for tests)
 *   cam.start(); cam.release() -> promise; cam.status() -> { state, text, tries, attached }; 'change'
 *   state: idle | waiting | asked | on | refused | rearonly | released
 */
const fs = require('fs');
const EventEmitter = require('events');

const SHOWING = '/dev/shm/camcluster/showing';
const READ_MS = 500, FRESH_MS = 15000, CHECK_MS = 5000, TRIES = 3, RETRY_MS = 30e3;
const VIEW = 1;                         // the front camera alone (recorder.js VIEWS: req 1 -> shown 1)
const SIDE = { left: 3, right: 4 };     // Drive Recorder's views of one side camera alone
const FALLBACK = [5, 7, 2], REAR = 2;   // recorder.js VIEWS: 5 front + rear -> shown 5/6, 7 all -> 7/9/10, 2 rear -> 2
const WITH_FRONT = [1, 5, 6, 7, 9, 10]; // CurrentState perspectives whose frames hold the front camera (camera.h)
const IF = {
    cam: ['de.bmw.infotainment.video.cameraproxy.CameraProxy', '1'],
    icam: ['de.bmw.infotainment.video.cameraproxy.ICAM2Proxy', '1'],
    xv: ['de.bmw.dass.XView3D', '1'],
};
const CAM_WIRE = { CLIENT_INDIRECT: 1, DR_ACTIVE: 51, MODE_MOSAIK: 50 };

const errText = (e) => String(e && e.message || e).slice(0, 120);
// a CurrentState's view in DR mode (else null); one that shows the front view alone applied
const drView = (s) => (s && typeof s === 'object' && /^(DR_ACTIVE|51)$/.test(String(s.application)) ? Number(s.perspective) : null);
const applied = (s) => drView(s) === VIEW;
const stateText = (s) => (s && typeof s === 'object' ? `${s.application}/${s.mode}/${s.perspective}` : 'no state');
// the ECU still starting (Drive Recorder's notReady) / showing a parking view (Xview3DApplication TOPREARVIEW 1,
// SIDEVIEW 2, RFK 3, OFFROAD 20, REMOTE360 60): no verdict on the front camera then
const notReady = (s) => !s || typeof s !== 'object' || /^(SIGNAL_UNFILLED|255)$/.test(String(s.application)) || Number(s.perspective) === 255;
const parking = (s) => /^(TOPREARVIEW|SIDEVIEW|RFK|OFFROAD|REMOTE360|1|2|3|20|60)$/.test(String(s.application));

function create(o) {
    const log = o.log || (() => {}), someipBuilders = o.someipBuilders, file = o.showingFile || SHOWING;
    const now = o.now || Date.now, setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const api = new EventEmitter();
    const px = {}, link = {};
    let state = 'idle', text = 'not needed';
    let period = null, staleSince = null, gen = 0;     // period: { tries } from the file turning fresh to 15 s stale
    let camCookie = null, attaching = null;
    let side = null;                                   // Side view: SIDE's view asked instead of the front (side())

    function set(s, t) {
        if (s === state && t === text) return;
        state = s; text = t;
        log(`camera request: ${s} (${t})`);
        api.emit('change', api.status());
    }

    // (the timeout as a number: iDrive 7's oap-sdk 24.x takes nothing else, an object timed out at once - Drive Recorder 2.3.6)
    function connect(name) {
        link[name] = link[name] || 'connecting';
        Promise.resolve().then(() => someipBuilders.buildAndInitTypedProxy(IF[name][0], IF[name][1], 10000))
            .then((p) => { px[name] = p; link[name] = 'ok'; log(`${name} connected`); },
                (e) => {
                    if (link[name] === 'connecting') log(`${name} not there yet (again every ${RETRY_MS / 1000} s):`, errText(e));
                    link[name] = `ERR ${errText(e)}`;
                    setTimer(() => connect(name), RETRY_MS);
                });
    }
    // getters, not notifiers (Car Data: notifiers often never fire for an app)
    const get = (name, field) => (px[name] ? Promise.resolve().then(() => px[name][field].getValue()).catch(() => undefined) : Promise.resolve(undefined));

    // enum arguments by name (getters return names); if the proxy refuses, once more as wire numbers
    const named = (fn, byName, byNumber) => Promise.resolve().then(() => fn(byName))
        .catch((e) => { log('enum names refused, trying numbers:', errText(e)); return fn(byNumber); });

    // CameraProxy 0xF789 is never offered on its own on the car (Drive Recorder 1.0.12): ICAM2Proxy extends it, so
    // clientAttach / clientDetach live on ICAM2Proxy. The catalogue lists only ICAM2Proxy's own changeState, so without
    // a typed method the call goes through the SDK proxy's native callMethod.
    function camCall(method, args) {
        if (px.cam) return px.cam[method](args);
        if (!px.icam) return Promise.reject(new Error('ICAM2Proxy not connected'));
        if (typeof px.icam[method] === 'function') return px.icam[method](args);
        if (px.icam._someIpProxy) return px.icam._someIpProxy.callMethod(method, args, 10000);
        return Promise.reject(new Error(`ICAM2Proxy has no ${method}`));
    }

    const camRequest = (view) => {
        const st = (a, m) => ({ cookie: camCookie, desiredState: { application: a, mode: m, perspective: view } });
        return named((a) => px.icam.changeState(a), st('DR_ACTIVE', 'MODE_MOSAIK'), st(CAM_WIRE.DR_ACTIVE, CAM_WIRE.MODE_MOSAIK));
    };

    // attached as icam2proxy's indirect client (one cookie: a second request waits for the attach under way)
    const attach = () => (camCookie !== null ? Promise.resolve(camCookie) : attaching || (attaching =
        named((a) => camCall('clientAttach', a), { type: 'CLIENT_INDIRECT' }, { type: CAM_WIRE.CLIENT_INDIRECT })
            .then((r) => { attaching = null; camCookie = r && typeof r === 'object' ? r.cookie : r; log(`camera: attached, cookie ${camCookie}`); return camCookie; },
                (e) => { attaching = null; throw e; })));

    function camRelease() {
        // an attach under way ends first (its cookie would stay in icam2proxy otherwise)
        return Promise.resolve(attaching).catch(() => null).then(() => {
            if (camCookie === null) return null;
            const c = camCookie;
            return Promise.resolve().then(() => camCall('clientDetach', { cookie: c }))
                .then(() => { camCookie = null; log(`camera: released (cookie ${c})`); }, (e) => log('camera release failed:', errText(e)));
        });
    }

    // the next read of the ECU's state, ms (CHECK_MS) from now (a newer one, or the period's end, cancels it)
    function schedule(ms) {
        const g = ++gen;
        setTimer(() => { if (g === gen) check(); }, ms === undefined ? CHECK_MS : ms);
    }

    function ask(view) {
        const own = view === VIEW || view === side, p = period, what = own ? `try ${++p.tries}` : `view ${view}`;
        p.asked = view;
        set('asked', own ? `asked ${p.tries} of ${TRIES}` : `front view not given, asking view ${view}`);
        return attach()
            .then(() => {
                if (period !== p) return null;                  // the widget went meanwhile
                return camRequest(view).then(() => log(`camera: cookie ${camCookie}, requested DR_ACTIVE / MODE_MOSAIK / ${view} (${what})`));
            })
            .catch((e) => log(`camera request failed (${what}):`, errText(e)))
            .then(() => { if (period === p) schedule(); });
    }

    function check() {
        const p = period;
        if (!p) return null;
        if (staleSince !== null) { schedule(); return null; }   // fresh again within 15 s: on from there
        return Promise.all([get('xv', 'CurrentState'), get('icam', 'currentState')]).then((both) => {
            if (period !== p) return null;
            const ss = both.filter((x) => x && typeof x === 'object'), s = ss[0], by = camCookie !== null ? '' : ', by another app';
            // no state read yet (the camera service still connecting): read again in 1 s before asking anything
            if (!ss.length && !p.waited) { p.waited = true; schedule(1000); return null; }
            if (side) {                                     // a side camera alone: no fall-backs
                const name = side === SIDE.left ? 'left' : 'right';
                if (ss.some((x) => drView(x) === side)) { set('on', `${name} camera on${by}`); schedule(); return null; }
                if (p.tries < TRIES) return ask(side);
                set('refused', `no ${name} camera given (${stateText(s)})`);
                schedule();
                return null;
            }
            const front = ss.find(applied) || ss.find((x) => WITH_FRONT.indexOf(drView(x)) >= 0);   // (a view with the front in it, e.g. Drive recorder's 7: taken as it is, not asked away)
            if (front) { set('on', `front view on${applied(front) ? '' : ` (view ${drView(front)})`}${by}`); schedule(); return null; }
            if (p.tries < TRIES) return ask(VIEW);
            if (p.rearOnly) { set('rearonly', 'rear camera only'); schedule(); return null; }    // holds for the period (camera given back)
            const rear = ss.some((x) => drView(x) === REAR);
            if (!px.icam) set('refused', /^ERR/.test(link.icam || '') ? 'no camera service' : 'camera service not there yet');
            else if (notReady(s)) set('refused', 'the cameras are not ready');
            else if (parking(s)) set('refused', 'a parking view has the cameras');
            else if (p.fb < FALLBACK.length) {
                if (FALLBACK[p.fb] === REAR) p.rearBefore = rear;   // the rear view already there: not ours, no proof
                return ask(FALLBACK[p.fb++]);
            } else if (p.asked === REAR && rear && !p.rearBefore) {
                p.rearOnly = true;
                set('rearonly', 'rear camera only');
                return camRelease().then(schedule);
            } else set('refused', `no front view given (${stateText(s)})`);
            schedule();
            return null;
        });
    }

    function endPeriod() {
        period = null; staleSince = null; gen++;
        const was = camCookie !== null || attaching;
        return camRelease().then(() => { if (was) set('released', 'released'); if (!period) set('idle', 'not needed'); });
    }

    function fresh() {
        try { return now() - fs.statSync(file).mtime.getTime() < FRESH_MS && String(fs.readFileSync(file, 'utf8')).trim() === 'front'; } catch (e) { return false; }
    }
    function read() {
        if (side || fresh()) {                         // (Side view: a period of its own, without camcluster)
            staleSince = null;
            if (!period) { period = { tries: 0, fb: 0, asked: null, rearBefore: false, rearOnly: false }; set('waiting', 'checking the camera'); schedule(0); }
        } else if (period) {
            if (staleSince === null) staleSince = now();
            else if (now() - staleSince >= FRESH_MS) endPeriod();
        }
    }
    function loop() { read(); setTimer(loop, READ_MS); }

    api.status = () => ({ state, text, tries: period ? period.tries : 0, attached: camCookie !== null });
    api.start = () => { Object.keys(IF).forEach(connect); loop(); };
    api.release = camRelease;
    /* Side view: 'left' / 'right' asks that camera alone (SIDE) while the cluster shows the camera, null the front
     * again; a change during a period asks at once. */
    api.side = (v) => {
        const want = SIDE[v] || null;
        if (want === side) return;
        side = want;
        log(`camera request: ${v ? v + ' camera' : 'front camera'} wanted`);
        if (period) { period.tries = 0; period.fb = 0; schedule(0); }
    };
    return api;
}

module.exports = { create, applied, drView, notReady, parking };
