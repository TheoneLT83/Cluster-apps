// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Robert Nisipeanu
'use strict';
/**
 * Writes the app's languages from locales/<code>.json (one file per
 * language; README.md, "Languages"):
 *
 *   { "hmiLanguages": ["CHINESISCH_SIMPLE", "KANTONESISCH_SIMPLE"],
 *                                               the HMI's display languages it is for
 *                                               (CommonTypes.Language, HMIContext)
 *     "rhmiTexts": ["zh_CN", "zh_yue_Hans_CN"], its RHMI text files, named as the
 *                                               oap-sdk names those languages
 *     "words": { "<English>": "<translation>" } }
 *
 * into src/locales.js, one of the app's modules (the words of the waze-on-cluster clients in src/).
 *
 *   node tools/gen_locales.js
 */
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const DIR = path.join(HERE, 'locales');
const OUT = path.join(HERE, 'src', 'locales.js');

/* The locales, by file name: { code, hmiLanguages, rhmiTexts, words }. */
function read() {
    return fs.readdirSync(DIR).filter((n) => /\.json$/.test(n)).sort().map((n) => {
        const l = JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
        if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(n.slice(0, -5)) || !Array.isArray(l.hmiLanguages) ||
            !Array.isArray(l.rhmiTexts) || !l.words || typeof l.words !== 'object') {
            throw new Error(`locales/${n}: not a locale (hmiLanguages, rhmiTexts, words)`);
        }
        return Object.assign({ code: n.slice(0, -5) }, l);
    });
}

function source() {
    return "'use strict';\n/* The app's languages, written by tools/gen_locales.js from locales/*.json. */\n" +
        `module.exports = ${JSON.stringify(read(), null, 1)};\n`;
}

function write() {
    fs.writeFileSync(OUT, source());
}

if (require.main === module) {
    write();
    console.log(`wrote ${path.relative(process.cwd(), OUT)}: ` + read().map((l) => l.code).join(', '));
}

module.exports = { read, source, write, OUT };
