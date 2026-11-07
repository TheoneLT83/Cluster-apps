// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * Stages the app's package tree robertn_waze_cluster@<version>/ from its kit source: app/ (app.json, main.js,
 * the HUD overlay, the turn signals), the waze-on-cluster clients of src/ and the cluster renderer's Node client
 * (native/cluster-render/js), built by the idrive7-apps kit (kit/tools/build.py --no-sdk, Python 3). The tree
 * has no node_modules/oap-sdk: the Store's deploy tool generates it on the head unit from the unit's own apps.
 *
 * The package starts with the platform ("mguAppStartType": "autostart", the Store's deploy tool lists it so), so
 * the HUD overlay runs without the app being opened, and the HMI's strings (the tile's name, the bar's buttons,
 * the HMI's settings screen) are in each display language the app has the words for (locales/).
 *
 *   node tools/stage.js        (after a change to app/, src/, locales/ or kit/; the tree is committed)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const HERE = path.join(__dirname, '..');
const REPO = path.join(HERE, '..', '..');
const ID = 'robertn_waze_cluster';
const SRC_MODULES = ['waze_cluster_control.js', 'logs_control.js', 'i18n.js', 'locales.js', 'qrcodegen.js', 'profile_sync.js'];

function main() {
    const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'app', 'app.json'), 'utf8'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-stage-'));
    try {
        const app = path.join(tmp, 'apps', ID);
        fs.mkdirSync(app, { recursive: true });
        fs.readdirSync(path.join(HERE, 'app')).forEach((f) => fs.copyFileSync(path.join(HERE, 'app', f), path.join(app, f)));
        SRC_MODULES.forEach((f) => fs.copyFileSync(path.join(HERE, 'src', f), path.join(app, f)));
        fs.copyFileSync(path.join(REPO, 'native', 'cluster-render', 'js', 'cluster_render_client.js'), path.join(app, 'cluster_render_client.js'));
        const env = Object.assign({}, process.env, { MGU_KIT_APPS: path.join(tmp, 'apps'), MGU_KIT_DIST: path.join(tmp, 'dist') });
        const r = cp.spawnSync('python3', [path.join(REPO, 'kit', 'tools', 'build.py'), '--no-sdk', ID], { env, stdio: 'inherit' });
        if (r.status !== 0) throw new Error('kit/tools/build.py failed');
        const built = path.join(tmp, 'dist', ID, 'source');
        // the tree of this version alone
        fs.readdirSync(HERE).filter((n) => n.startsWith(ID + '@') && fs.statSync(path.join(HERE, n)).isDirectory())
            .forEach((n) => fs.rmSync(path.join(HERE, n), { recursive: true, force: true }));
        const tree = path.join(HERE, `${ID}@${spec.version}`);
        fs.cpSync(built, tree, { recursive: true });
        fs.copyFileSync(path.join(HERE, 'CHANGELOG.md'), path.join(tree, 'CHANGELOG.md'));
        fs.copyFileSync(path.join(HERE, 'LICENSE'), path.join(tree, 'LICENSE'));
        fs.copyFileSync(path.join(HERE, 'LICENSE-qrcodegen.txt'), path.join(tree, 'LICENSE-qrcodegen.txt'));
        fs.copyFileSync(path.join(REPO, 'kit', 'LICENSE'), path.join(tree, 'LICENSE-kit.txt'));
        // the app's glyph atlases and their fonts' licences, beside the kit's (tools/bake_fonts.py)
        fs.readdirSync(path.join(HERE, 'fonts')).forEach((f) => fs.copyFileSync(path.join(HERE, 'fonts', f), path.join(tree, 'javascript', 'kit', 'fonts', f)));
        const pj = path.join(tree, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
        // as the kit's packages: no files[] (every file of the tree is the package)
        Object.assign(pkg, { mguLocalOnly: true, mguAppStartType: 'autostart' });
        fs.writeFileSync(pj, JSON.stringify(pkg, null, 2) + '\n');
        // the HMI's strings (the tile's name, the bar's buttons, the HMI's settings screen) in each language: every
        // one the app has the words for
        const texts = path.join(tree, 'rhmiData', 'variantGroups', 'Common', 'texts');
        const english = JSON.parse(fs.readFileSync(path.join(texts, 'en_GB.json'), 'utf8'));
        const byFile = {};
        require('./gen_locales.js').read().forEach((l) => l.rhmiTexts.forEach((name) => { byFile[`${name}.json`] = l.words; }));
        fs.readdirSync(texts).forEach((name) => {
            const words = byFile[name] || {};
            const out = {};
            Object.keys(english).forEach((id) => { out[id] = Object.prototype.hasOwnProperty.call(words, english[id]) ? words[english[id]] : english[id]; });
            fs.writeFileSync(path.join(texts, name), JSON.stringify(out, null, 1) + '\n');
        });
        console.log(`staged ${path.relative(process.cwd(), tree)}`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

main();
