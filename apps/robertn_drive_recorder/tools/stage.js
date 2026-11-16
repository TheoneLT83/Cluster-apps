// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/**
 * Stages the app's package tree robertn_drive_recorder@<version>/ from app/, built by the kit (kit/tools/build.py --no-sdk,
 * Python 3). The tree has no node_modules/oap-sdk: the Store's deploy tool generates it on the head unit. The package
 * starts with the platform ("mguAppStartType": "autostart"), so the cameras record from the car's start.
 *
 *   node tools/stage.js        (after a change to app/ or kit/; the tree is committed)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const HERE = path.join(__dirname, '..');
const REPO = path.join(HERE, '..', '..');
const ID = 'robertn_drive_recorder';

const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'app', 'app.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-stage-'));
try {
    const app = path.join(tmp, 'apps', ID);
    fs.mkdirSync(app, { recursive: true });
    fs.readdirSync(path.join(HERE, 'app')).forEach((f) => fs.copyFileSync(path.join(HERE, 'app', f), path.join(app, f)));
    const env = Object.assign({}, process.env, { MGU_KIT_APPS: path.join(tmp, 'apps'), MGU_KIT_DIST: path.join(tmp, 'dist') });
    const r = cp.spawnSync('python3', [path.join(REPO, 'kit', 'tools', 'build.py'), '--no-sdk', ID], { env, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('kit/tools/build.py failed');
    fs.readdirSync(HERE).filter((n) => n.startsWith(ID + '@') && fs.statSync(path.join(HERE, n)).isDirectory())
        .forEach((n) => fs.rmSync(path.join(HERE, n), { recursive: true, force: true }));
    const tree = path.join(HERE, `${ID}@${spec.version}`);
    fs.cpSync(path.join(tmp, 'dist', ID, 'source'), tree, { recursive: true });
    ['CHANGELOG.md', 'LICENSE', 'README.md'].forEach((f) => fs.copyFileSync(path.join(HERE, f), path.join(tree, f)));
    fs.copyFileSync(path.join(REPO, 'kit', 'LICENSE'), path.join(tree, 'LICENSE-kit.txt'));
    fs.copyFileSync(path.join(REPO, 'native', 'iteriodev-drplay', 'LICENSE.md'), path.join(tree, 'LICENSE-IterioDev.md'));
    const pj = path.join(tree, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
    Object.assign(pkg, { mguLocalOnly: true, mguAppStartType: 'autostart' });
    fs.writeFileSync(pj, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`staged ${path.relative(process.cwd(), tree)}`);
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
