// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* perf - what uses the head unit's CPU and memory, for the Save logs archive (perf.txt) and journal_keep.js's load
 * lines: who, by name - an app by the app it is (its uid is the one of its folder oap_<uid>, whose package.json names
 * it), a tool by its systemd unit - and why, by its busiest threads.
 *
 *   node perf.js [ms]       the report over ms (default SAMPLE_MS) on stdout
 *
 * Read from /proc only (stat, status, task/<tid>/stat, cgroup, loadavg, meminfo, pressure/*): names, numbers and
 * units, never a command line's arguments or an environment. Node 8 on the unit. No dependencies.
 */
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var PROC = process.env.WOC_PROC || '/proc';
var OAP = process.env.WOC_OAP || '/var/opt/public/oap';
var CLK_TCK = 100;
var SAMPLE_MS = Number(process.env.WOC_PERF_MS) || 3000;   // (tests: shorter)
var THREAD_MS = Math.min(1000, SAMPLE_MS);
var TOP = 25, THREADS_OF = 5, THREADS = 5, MEM_TOP = 10;

function readText(f) { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } }

/* A process's or thread's stat: { name, state, ticks, nice, threads, start } or null. */
function stat(file) {
    var s = readText(file);
    if (!s) return null;
    var open = s.indexOf('('), close = s.lastIndexOf(')');
    if (open < 0 || close < open) return null;
    /* the fields after the name: [0] state, [11] utime, [12] stime, [16] nice, [17] threads, [19] starttime */
    var f = s.slice(close + 2).split(' ');
    return { name: s.slice(open + 1, close).replace(/[^\x21-\x7e]/g, '_'), state: f[0], ticks: Number(f[11]) + Number(f[12]),
        nice: Number(f[16]), threads: Number(f[17]), start: f[19] };
}

/* The apps by uid: { uid: name } from OAP/oap_<uid>/source/package.json (its name, else the folder's). */
function apps() {
    var out = {};
    var names;
    try { names = fs.readdirSync(OAP); } catch (e) { return out; }
    names.forEach(function (n) {
        var m = /^oap_(\d+)$/.exec(n);
        if (!m) return;
        var name = n;
        try { name = JSON.parse(readText(path.join(OAP, n, 'source', 'package.json')) || '{}').name || n; } catch (e) { /* the folder's */ }
        out[m[1]] = String(name).replace(/[^\w.@\/-]/g, '_').slice(0, 48);
    });
    return out;
}

function uidOf(pid) {
    var m = /^Uid:\s+(\d+)/m.exec(readText(PROC + '/' + pid + '/status') || '');
    return m ? m[1] : null;
}

function rssMb(pid) {
    var m = /^VmRSS:\s+(\d+)/m.exec(readText(PROC + '/' + pid + '/status') || '');
    return m ? Number(m[1]) / 1024 : 0;
}

/* Its systemd unit (the last part of its cgroup path that names one), or ''. */
function unitOf(pid) {
    var c = readText(PROC + '/' + pid + '/cgroup') || '', best = '';
    c.split('\n').forEach(function (l) {
        var m = /([\w@.-]+\.(service|scope|slice))\s*$/.exec(l);
        if (m && (!best || /\.(service|scope)$/.test(m[1]))) best = m[1];
    });
    return best;
}

/* What it is: an app's name for a process of an app's uid ("app:edrive"), else its name, with its unit. */
function label(pid, name, appsByUid) {
    var uid = uidOf(pid), app = uid !== null && appsByUid[uid];
    // an app's folder not readable (the logs service's user): its uid, which the root report's list names
    return app ? 'app:' + app : name === 'node' && uid !== null && Number(uid) >= 1000 ? 'node(uid ' + uid + ')' : name;
}

function sample() {
    var names;
    try { names = fs.readdirSync(PROC); } catch (e) { names = []; }
    var procs = {};
    names.forEach(function (n) {
        if (!/^\d+$/.test(n)) return;
        var s = stat(PROC + '/' + n + '/stat');
        if (s) procs[n + '/' + s.start] = Object.assign({ pid: n }, s);
    });
    return { at: Date.now(), procs: procs };
}

function threadTicks(pid) {
    var out = {}, names;
    try { names = fs.readdirSync(PROC + '/' + pid + '/task'); } catch (e) { return out; }
    names.forEach(function (t) {
        var s = stat(PROC + '/' + pid + '/task/' + t + '/stat');
        if (s) out[t] = s;
    });
    return out;
}

function sleepMs(ms) {
    try { cp.execFileSync('sleep', [String(ms / 1000)]); } catch (e) { /* as long as it slept */ }
}

/* The report's text over ms. */
function report(ms) {
    ms = ms || SAMPLE_MS;
    var appsByUid = apps(), lines = [];
    var cpus = (readText(PROC + '/stat') || '').split('\n').filter(function (l) { return /^cpu\d/.test(l); }).length || '?';
    var load = (readText(PROC + '/loadavg') || '?').trim();
    var mem = readText(PROC + '/meminfo') || '', kb = function (k) { var m = new RegExp('^' + k + ':\\s+(\\d+)', 'm').exec(mem); return m ? Math.round(m[1] / 1024) + ' MiB' : '?'; };
    var up = (readText(PROC + '/uptime') || '?').split(' ')[0];
    lines.push('perf.txt: what used the head unit over ' + (ms / 1000) + ' s at ' + new Date().toISOString() + ', up ' + Math.round(Number(up)) + ' s');
    lines.push('cpus ' + cpus + '; load ' + load + ' (1, 5, 15 min; running/all; last pid)');
    lines.push('memory: total ' + kb('MemTotal') + ', available ' + kb('MemAvailable') + ', free ' + kb('MemFree') + ', swap free ' + kb('SwapFree'));
    ['cpu', 'memory', 'io'].forEach(function (k) {
        var p = readText(PROC + '/pressure/' + k);
        if (p) lines.push('pressure ' + k + ': ' + p.trim().split('\n').join(' | '));
    });

    var a = sample(), before = {};
    sleepMs(ms);
    var b = sample(), secs = (b.at - a.at) / 1000;
    var rows = Object.keys(b.procs).map(function (k) {
        var p = b.procs[k], was = a.procs[k];
        return { p: p, pct: (p.ticks - (was ? was.ticks : p.ticks)) / CLK_TCK / secs * 100 };
    });
    rows.sort(function (x, y) { return y.pct - x.pct; });
    var total = rows.reduce(function (s, r) { return s + r.pct; }, 0);
    lines.push('');
    lines.push('CPU over ' + secs.toFixed(1) + ' s: ' + total.toFixed(0) + ' % in all (100 % = one core of ' + cpus + '), at most ' + TOP + ' busiest:');
    lines.push('   cpu%   rss MiB  thr  nice st  pid     who                                       unit');
    var top = rows.filter(function (r) { return r.pct >= 0.1; }).slice(0, TOP);
    top.forEach(function (r) {
        var p = r.p;
        lines.push(pad(r.pct.toFixed(1), 7) + pad(rssMb(p.pid).toFixed(0), 10) + pad(String(p.threads), 5) + pad(String(p.nice), 6) + '  ' +
            p.state + '  ' + padR(p.pid, 8) + padR(label(p.pid, p.name, appsByUid), 42) + unitOf(p.pid));
    });

    /* why: the busiest threads of the busiest processes, sampled again over THREAD_MS */
    var busy = top.slice(0, THREADS_OF).filter(function (r) { return r.pct >= 1; });
    busy.forEach(function (r) { before[r.p.pid] = threadTicks(r.p.pid); });
    var t0 = Date.now();
    sleepMs(THREAD_MS);
    var tsecs = (Date.now() - t0) / 1000;
    lines.push('');
    lines.push('the busiest threads of the busiest processes, over ' + tsecs.toFixed(1) + ' s:');
    busy.forEach(function (r) {
        var now = threadTicks(r.p.pid), was = before[r.p.pid] || {};
        var ts = Object.keys(now).map(function (t) {
            return { name: now[t].name, pct: (now[t].ticks - (was[t] && was[t].start === now[t].start ? was[t].ticks : now[t].ticks)) / CLK_TCK / tsecs * 100 };
        }).filter(function (t) { return t.pct > 0; }).sort(function (x, y) { return y.pct - x.pct; }).slice(0, THREADS);
        lines.push('  ' + label(r.p.pid, r.p.name, appsByUid) + '[' + r.p.pid + ']: ' +
            (ts.map(function (t) { return t.name + ' ' + t.pct.toFixed(1) + '%'; }).join(', ') || 'none in that second'));
    });

    var byMem = Object.keys(b.procs).map(function (k) { return b.procs[k]; })
        .map(function (p) { return { p: p, mb: rssMb(p.pid) }; }).sort(function (x, y) { return y.mb - x.mb; }).slice(0, MEM_TOP);
    lines.push('');
    lines.push('the most memory (resident):');
    byMem.forEach(function (m) { lines.push(pad(m.mb.toFixed(0), 7) + ' MiB  ' + label(m.p.pid, m.p.name, appsByUid) + '[' + m.p.pid + ']'); });

    /* the load lines in the journals name processes by pid: each node process's app, to read them */
    lines.push('');
    lines.push('node processes now (for the load lines\' node[pid]): ' + Object.keys(b.procs).map(function (k) { return b.procs[k]; })
        .filter(function (p) { return p.name === 'node'; })
        .map(function (p) { return p.pid + ' ' + label(p.pid, p.name, appsByUid) + (unitOf(p.pid) ? ' (' + unitOf(p.pid) + ')' : ''); }).join('; '));
    var uids = Object.keys(appsByUid);
    if (uids.length) lines.push('apps by uid: ' + uids.map(function (u) { return u + ' ' + appsByUid[u]; }).join('; '));
    return lines.join('\n') + '\n';
}

function pad(s, n) { while (s.length < n) s = ' ' + s; return s; }
function padR(s, n) { s = String(s); while (s.length < n) s += ' '; return s.length > n ? s.slice(0, n - 1) + ' ' : s; }

module.exports = { report: report, apps: apps, label: label, unitOf: unitOf, stat: stat };

if (require.main === module) {
    process.stdout.write(report(Number(process.argv[2]) || SAMPLE_MS));
}
