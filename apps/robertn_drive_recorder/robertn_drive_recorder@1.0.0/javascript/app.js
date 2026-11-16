'use strict';
/**
 * Drive recorder - the car's cameras kept recording, a clip saved when asked; watch, lock, delete and copy clips to a
 * USB stick while parked. The recording and the clips are IterioDev's Drive Recorder player (the Store tool
 * iteriodev-drplay: mgu-driverec-rx keeps the cameras' last seconds, mgu-drplay lists, plays, locks, deletes and copies
 * the clips); recorder.js, player.js and meta.js are IterioDev's own modules, unchanged, used with their permission.
 *
 *   Record    recording or not, the seconds kept, the cameras (the views this car has), Save clip
 *   Clips     newest first; a clip opens it: the picture (the player's frame file, drawn by the GPU renderer), speed
 *             and time, play / pause, back / forward 10 s, its cameras, Lock, Delete, Copy to USB
 *   Settings  the clip length, Start with the car, the storage used, the status lines; IterioDev's credits
 *
 * Recording runs with the car (app.json autostart: background). The picture only while the car stands still.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { withAlpha } = require('./kit/canvas');
const recorder = require('./recorder');
const { Player } = require('./player');
const meta = require('./meta');

const W = 1600, H = 520;
const GO = '#2fd27a', REC = '#e1001a';
const TABS = ['Record', 'Clips', 'Settings'];
const VIDEO_ID = 1, VIDEO_FILE = '/dev/shm/mgu-video-drplay';
// the player's usb-rw.sh makes the stick writable while this file is fresh (Copy to USB open or a copy running)
const USB_FLAG = '/dev/shm/oap-driverecorder-usb';
const CAM_NAMES = ['All', 'Front', 'Rear', 'Left', 'Right'];
const CAM_KEYS = ['all', 'front', 'rear', 'left', 'right'];
const CAMS = [[1, 2, 3, 4], [1, 2], [3, 4], [1], [2], [3], [4]];       // a clip's layout (player.js cams) -> its cameras
const PARKED_KMH = 1;
const ROWS = 6;
const CREDITS = 'Recording and playback: IterioDev\'s Drive Recorder player (github.com/IterioDev/car-apps), used with permission';

const pad = (n) => (n < 10 ? '0' : '') + n;
const clock = (s) => { s = Math.max(0, Math.floor(Number(s) || 0)); return Math.floor(s / 60) + ':' + pad(s % 60); };
const size = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round((b || 0) / 1048576) + ' MB');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* a clip id (YYYYMMDD_HHMMSS) -> "Today 13:42" | "Yesterday 18:05" | "28 Oct 09:15" */
function when(id) {
    const m = /^(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)/.exec(id || '');
    if (!m) return id || '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]), now = new Date(), t = m[4] + ':' + m[5];
    const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - d) / 864e5);
    return days === 0 ? 'Today ' + t : days === 1 ? 'Yesterday ' + t : (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + t;
}

/* With or without the screen (the car's start): the recorder and the player tool. */
async function background(bg) {
    const { log, dataDir } = bg;
    const say = (...a) => log.info(a.map((x) => (typeof x === 'string' ? x : String(x && x.message || x))).join(' '));
    // the recorder's settings, in its own file (as IterioDev's app keeps them: driverec.json)
    const file = path.join(dataDir, 'driverec.json');
    let settings = { length: 1, buffer: true, autoCam: true };
    try { settings = Object.assign(settings, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* defaults */ }
    const saveSettings = () => { try { fs.writeFileSync(file, JSON.stringify(settings)); } catch (e) { say('settings not saved:', e); } };
    let someipBuilders = null;
    try { someipBuilders = require('oap-sdk').someipBuilders; } catch (e) { say('no SOME/IP builders:', e); }
    const rec = recorder.create({ someipBuilders, log: say, settings, saveSettings });
    const player = new Player({ log: say });
    const speed = { kmh: null };
    player.on('up', () => { rec.tool = { up: true, full: player.full }; });
    player.on('down', () => { rec.tool = { up: false, full: false }; });
    player.on('clips', () => { rec.tool = { up: true, full: player.full }; });
    player.on('done', (d) => say('player: ' + d.cmd + ' ' + d.clip + ' ' + (d.ok ? 'ok' : 'failed') + ' ' + d.text));
    if (someipBuilders) {
        rec.start();
        // the cameras' state: what the recorder holds is counted from when they show the view asked for
        const watch = (iface, fields) => someipBuilders.buildAndInitTypedProxy(iface, '1', 10000)
            .then((p) => fields.forEach((f) => {
                if (p[f] && typeof p[f].subscribe === 'function') p[f].subscribe((v) => rec.camEvent(v, f === 'CurrentState' ? 'xv' : 'icam'));
            }))
            .catch((e) => { say('camera state ' + iface.split('.').pop() + ':', e); setTimeout(() => watch(iface, fields), 30000); });
        watch('de.bmw.dass.XView3D', ['CurrentState']);
        watch('de.bmw.infotainment.video.cameraproxy.ICAM2Proxy', ['currentState']);
    }
    player.connect();
    bg.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
        statusCarSpeed2: (v) => { const k = v && v.speedVehicleCentreOfGravity; speed.kmh = typeof k === 'number' && k !== 65535 ? k / 64 : null; },
    }, log, { pollMs: 1000 }).catch((e) => say('speed:', e));
    return { rec, player, settings, saveSettings, speed };
}

mgu.run({
    background,
    async start(ctx) {
        const { ui, log } = ctx;
        const { rec, player, settings, speed } = ctx.background || await background(ctx);
        let page = 0, open = null, copying = false, top = 0, metaOf = { id: null, m: null };
        const parked = () => typeof speed.kmh === 'number' && speed.kmh < PARKED_KMH;
        const clipOf = (id) => player.clips.find((c) => c.id === id) || null;
        const gpu = () => (ctx.display && ctx.display.gpu && ctx.display.gpu.native ? ctx.display.gpu : null);
        const go = (fn) => () => { fn(); return render(); };

        /* ---- Record ---- */
        function drawRecord(cv, t) {
            const s = rec.status(), on = s.vb === 'RECORDING', tool = player.up;
            G.panel(cv, t, 24, 44, 900, 468, null);
            const head = !tool ? ['PLAYER NOT RUNNING', t.crit] : s.vb === null ? ['STARTING', t.dim] : on ? ['RECORDING', REC] : ['NOT RECORDING', t.warn];
            if (on) cv.circle(64, 96, 12, REC);
            cv.text(head[0], on ? 88 : 48, 106, 34, head[1], { font: 'bold', spacing: 2 });
            const held = Math.round(s.filled || 0);
            cv.text(tool ? 'The last ' + held + ' s kept' : 'Install "Drive Recorder player" from the Store', 48, 156, 26, t.dim);
            cv.text('CAMERAS', 48, 222, 22, t.dim, { font: 'bold', spacing: 1.5 });
            (s.views || []).forEach((v, i) => {
                G.button(cv, t, 48 + i * 212, 240, 200, 52, v.label, go(() => rec.setView(v.req)), { primary: s.view === v.req, key: 'view-' + v.req, busy: s.checking });
            });
            if (s.checking) cv.text('Checking which cameras this car records…', 48, 330, 22, t.dim);
            else if (s.camMsg) cv.text(String(s.camMsg).slice(0, 80), 48, 330, 22, s.camOk ? t.dim : t.warn);
            const last = s.lastState === 'saved' ? ['Saved ' + s.lastClip, GO] : s.lastState === 'failed' ? ['Not saved: ' + s.lastClip, t.crit]
                : s.lastState === 'saving' ? ['Saving ' + s.lastClip + '…', t.text] : null;
            if (last) cv.text(last[0].slice(0, 70), 48, 400, 26, last[1], { font: 'bold' });
            cv.text(player.clips.length + ' clips · ' + size(player.total) + ' of 4 GB' + (player.full ? ' · full (locked clips)' : ''), 48, 488, 22, player.full ? t.warn : t.dim);

            // Save clip: the seconds before and after
            G.panel(cv, t, 948, 44, 628, 468, null);
            const can = tool && on && (s.filled || 0) >= s.minBefore && s.lastState !== 'saving';
            G.button(cv, t, 988, 150, 548, 150, 'Save clip', go(() => rec.save()), { primary: can, key: 'save', busy: !can });
            cv.text(s.before + ' s before · ' + s.after + ' s after', 1262, 350, 26, t.dim, { align: 'center' });
        }

        /* ---- Clips: the list, or a clip opened ---- */
        function drawClips(cv, t) {
            if (open && clipOf(open)) return drawViewer(cv, t, clipOf(open));
            open = null;
            const clips = player.clips;
            G.panel(cv, t, 24, 44, 1552, 468, null);
            if (!player.up) { cv.text('The Drive Recorder player is not running. Install it from the Store.', 48, 130, 26, t.dim); return; }
            if (!clips.length) { cv.text('No clips yet: Save clip on the Record tab.', 48, 130, 26, t.dim); return; }
            top = Math.max(0, Math.min(top, clips.length - ROWS));
            clips.slice(top, top + ROWS).forEach((c, i) => {
                const y = 60 + i * 70;
                if (cv.target && !c.pending) cv.target(36, y, 1340, 62, go(() => { open = c.id; player.play(c.id, 0); }), 'clip-' + c.id, 10);
                cv.roundRect(36, y, 1340, 62, 10, withAlpha(t.text, 0.05));
                cv.text(when(c.id), 60, y + 41, 28, c.pending ? t.dim : t.text, { font: 'bold' });
                cv.text(clock(c.secs), 420, y + 41, 26, t.dim);
                cv.text(c.pending ? 'saving…' : (CAMS[c.cams] || CAMS[0]).length === 4 ? 'all cameras' : (CAMS[c.cams] || []).map((n) => CAM_NAMES[n].toLowerCase()).join(' + '), 560, y + 41, 24, t.dim);
                cv.text(size(c.bytes), 1100, y + 41, 24, t.dim, { align: 'right' });
                if (c.locked) cv.text('LOCKED', 1356, y + 41, 22, t.warn, { font: 'bold', align: 'right', spacing: 1 });
            });
            if (top > 0) G.button(cv, t, 1396, 60, 160, 64, 'Newer', go(() => { top = Math.max(0, top - ROWS); }), { key: 'up' });
            if (top + ROWS < clips.length) G.button(cv, t, 1396, 420, 160, 64, 'Older', go(() => { top += ROWS; }), { key: 'down' });
            cv.text((top + 1) + '-' + Math.min(clips.length, top + ROWS) + ' of ' + clips.length, 1476, 290, 22, t.dim, { align: 'center' });
        }

        function drawViewer(cv, t, c) {
            const st = player.state, mine = st.clip === c.id, playing = mine && st.state === 'playing';
            const pos = mine ? st.pos : 0, dur = mine && st.dur ? st.dur : c.secs;
            // the picture (left), or why there is none
            G.panel(cv, t, 24, 44, 1000, 468, null);
            const vx = 40, vy = 60, vw = 968, vh = 386;
            cv.roundRect(vx, vy, vw, vh, 8, '#000000');
            const show = parked() && mine && ['playing', 'paused', 'ended'].indexOf(st.state) >= 0 && gpu() && cv.video;
            if (show) cv.video(VIDEO_ID, vx, vy, vw, vh, 8);
            else cv.text(!parked() ? 'Plays only while the car stands still' : !gpu() ? 'The picture needs the GPU renderer' : st.state === 'loading' ? 'Loading…' : '',
                vx + vw / 2, vy + vh / 2, 26, t.dim, { align: 'center' });
            // speed and time at the position (the clip's metadata)
            if (metaOf.id !== c.id) { metaOf = { id: c.id, m: null }; recorder.REC_DIRS.forEach((d) => ['', '/locked'].forEach((sub) => { const f = d + sub + '/' + c.id + '_Metadata.json'; if (!metaOf.m && fs.existsSync(f)) metaOf.m = meta.load(f); })); }
            const at = metaOf.m ? meta.at(metaOf.m, c.secs, pos) : null;
            cv.text(when(c.id) + (at ? '   ' + at.time + '   ' + Math.round(at.kmh) + ' km/h' : ''), 40, 488, 24, t.text, { font: 'bold' });
            // the time line
            const tx = 400, tw = 600, f = dur ? Math.max(0, Math.min(1, pos / dur)) : 0;
            cv.roundRect(tx, 476, tw, 8, 4, t.track);
            cv.roundRect(tx, 476, Math.max(8, tw * f), 8, 4, t.accent);
            cv.text(clock(pos) + ' / ' + clock(dur), tx + tw, 500, 20, t.dim, { align: 'right' });

            // the controls (right)
            G.panel(cv, t, 1048, 44, 528, 468, null);
            const b = (x, y, w, label, fn, o) => G.button(cv, t, x, y, w, 52, label, go(fn), o);
            b(1068, 60, 156, '-10 s', () => player.seek(Math.max(0, pos - 10)), { key: 'back' });
            b(1236, 60, 156, playing ? 'Pause' : 'Play', () => (playing ? player.pause() : mine && st.state !== 'ended' ? player.resume() : player.play(c.id, 0)), { primary: true, key: 'play' });
            b(1404, 60, 156, '+10 s', () => player.seek(pos + 10), { key: 'fwd' });
            const cams = CAMS[c.cams] || CAMS[0];
            if (cams.length > 1) [0].concat(cams).forEach((n, i) => b(1068 + i * 100, 128, 92, CAM_NAMES[n], () => player.cam(n), { primary: mine && st.cam === n, key: 'cam-' + n }));
            if (!copying) {
                b(1068, 196, 240, c.locked ? 'Unlock' : 'Lock', () => player.lock(c.id, !c.locked), { primary: c.locked, key: 'lock' });
                b(1320, 196, 240, 'Delete', () => { player.remove(c.id); player.stop(); open = null; }, { key: 'del', confirm: true });
                b(1068, 264, 492, 'Copy to USB', () => { copying = true; player.askUsb(); }, { key: 'copy' });
            } else {
                const stick = player.stick;
                cv.text(stick && stick.label ? 'USB: ' + stick.label + ' · ' + size(stick.free) + ' free' : 'Put a USB stick in…', 1068, 216, 22, stick && stick.label ? t.text : t.dim);
                ['all'].concat(cams.map((n) => CAM_KEYS[n])).forEach((k, i) => b(1068 + (i % 3) * 164, 236 + Math.floor(i / 3) * 64, 156,
                    k === 'all' ? 'As recorded' : CAM_NAMES[CAM_KEYS.indexOf(k)] + ' MP4', () => player.copy(c.id, k), { key: 'cp-' + k, busy: !(stick && stick.label) || !!copyNow }));
                b(1068, 372, 156, 'Done', () => { copying = false; }, { key: 'cp-done' });
                if (copyNow) cv.text('Copying ' + (copyNow.pct || 0) + ' %' + (copyNow.text ? ' · ' + copyNow.text : ''), 1240, 404, 22, t.text);
            }
            if (lastDone && Date.now() - lastDone.at < 6000) cv.text((lastDone.ok ? 'Done: ' : 'Failed: ') + lastDone.cmd + (lastDone.text ? ' (' + lastDone.text + ')' : ''), 1068, 470, 22, lastDone.ok ? GO : t.crit);
            b(1408, 440, 152, 'Back', () => { player.stop(); open = null; copying = false; }, { key: 'close' });
        }
        let copyNow = null, lastDone = null;
        player.on('copy', (c) => { copyNow = c.pct >= 100 ? null : c; });
        player.on('done', (d) => { lastDone = Object.assign({ at: Date.now() }, d); if (d.cmd === 'copy') copyNow = null; });

        /* ---- Settings ---- */
        function drawSettings(cv, t) {
            const s = rec.status();
            G.panel(cv, t, 24, 44, 760, 418, null);
            cv.text('CLIP LENGTH', 48, 92, 22, t.dim, { font: 'bold', spacing: 1.5 });
            recorder.LENGTHS.forEach(([b, a], i) => G.button(cv, t, 48 + i * 178, 110, 166, 52, b + ' + ' + a + ' s', go(() => rec.setLength(i)),
                { primary: settings.length === i, key: 'len-' + i }));
            cv.text('seconds before + after the tap', 48, 196, 20, t.dim);
            cv.text('START WITH THE CAR', 48, 256, 22, t.dim, { font: 'bold', spacing: 1.5 });
            G.button(cv, t, 48, 274, 166, 52, s.autoCam ? 'On' : 'Off', go(() => {
                settings.autoCam = !s.autoCam; if (ctx.background && ctx.background.saveSettings) ctx.background.saveSettings();
                if (settings.autoCam) rec.setView(settings.view);
            }), { primary: s.autoCam, key: 'auto' });
            cv.text('the cameras record from the car\'s start', 230, 308, 20, t.dim);
            cv.text('STORAGE', 48, 380, 22, t.dim, { font: 'bold', spacing: 1.5 });
            const f = Math.min(1, (player.total || 0) / 4294967296);
            cv.roundRect(48, 396, 700, 12, 6, t.track);
            cv.roundRect(48, 396, Math.max(12, 700 * f), 12, 6, player.full ? t.warn : t.accent);
            cv.text(size(player.total) + ' of 4 GB · the oldest unlocked clips are replaced', 48, 440, 20, t.dim);
            G.panel(cv, t, 808, 44, 768, 418, 'Status');
            (s.lines || []).slice(0, 7).forEach((l, i) => cv.text(String(l).slice(0, 76), 832, 116 + i * 32, 17, t.dim));
            cv.text('Player: ' + (player.up ? 'running ' + (player.version || '') : 'not running'), 832, 440, 18, player.up ? t.dim : t.crit);
            cv.text(CREDITS, 800, 498, 18, t.dim, { align: 'center' });
        }

        let usbAt = 0;
        async function render() {
            const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg);
            [drawRecord, drawClips, drawSettings][page](cv, t);
            G.frame(cv, t, TABS, page, [rec.status().vb === 'RECORDING' && { text: 'REC', color: REC }]);
            return ui.image('MAIN_GFX', cv);
        }
        // the frame file named to the renderer while a clip is open; the USB stick asked for and kept writable while copying
        setInterval(() => {
            try {
                const g = gpu();
                if (g) { if (open && parked()) g.video(VIDEO_ID, VIDEO_FILE); else g.dropVideo(VIDEO_ID); }
                if (open && !parked() && player.state.state === 'playing') player.pause();
                rec.active = true;
                if ((copying || copyNow) && Date.now() - usbAt >= 3000) {
                    usbAt = Date.now();
                    try { fs.writeFileSync(USB_FLAG, usbAt + '\n'); } catch (e) { /* another uid's file */ }
                    if (!(player.stick && player.stick.label)) player.askUsb();
                }
            } catch (e) { log.warn('tick: ' + e); }
        }, 500);
        ctx.onTab((i) => { page = i; if (i !== 1 && open) { player.stop(); open = null; copying = false; } return render(); });
        ctx.loop('MAIN', 4, render);
        render().then(() => log.info('first frame done')).catch((e) => log.warn('first render: ' + e));
    },
});
