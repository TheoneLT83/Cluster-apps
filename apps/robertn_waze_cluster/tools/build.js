// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Robert Nisipeanu
'use strict';
/**
 * Packs the app's staged tree (tools/stage.js) into its OAP tgz, robertn_waze_cluster@<version>.tgz, every file
 * of it, with tools/oap_pack.js's writer: byte for byte the same on any machine. The package has no
 * node_modules/oap-sdk; the Store's deploy tool generates it on the head unit (mgu-store tools/oap_link.js
 * preparePackage).
 *
 *   node tools/build.js
 */
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const { tgz, MTIME } = require(path.join(HERE, '..', '..', 'tools', 'oap_pack.js'));

/* Every regular file of the tree, sorted, as tools/oap_pack.js writes them (the kit's packages have no files[]). */
function files(dir, rel) {
    return fs.readdirSync(path.join(dir, rel)).sort().reduce((out, n) => {
        const r = rel ? `${rel}/${n}` : n;
        const st = fs.lstatSync(path.join(dir, r));
        return st.isDirectory() ? out.concat(files(dir, r)) : st.isFile() && n !== '.DS_Store' && !n.startsWith('._') ? out.concat(r) : out;
    }, []);
}

try {
    const tree = fs.readdirSync(HERE).find((n) => /^robertn_waze_cluster@\d+\.\d+\.\d+$/.test(n));
    if (!tree) throw new Error('no staged tree: node tools/stage.js');
    const out = path.join(HERE, `${tree}.tgz`);
    const dir = path.join(HERE, tree);
    const list = files(dir, '');
    fs.writeFileSync(out, tgz(list.map((rel) => ({ name: rel, data: fs.readFileSync(path.join(dir, rel)), mode: 0o644 })), MTIME));
    console.log(JSON.stringify({ tgz: path.basename(out), files: list.length }, null, 2));
} catch (e) {
    console.error(`build: ${e.message}`);
    process.exitCode = 1;
}
