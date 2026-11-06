// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Robert Nisipeanu
'use strict';
/**
 * Offline check of the languages of the waze-on-cluster clients (src/i18n.js, locales/*.json and
 * what tools/gen_locales.js writes from them): every word they show (the t() literals of
 * src/waze_cluster_control.js and src/logs_control.js, the words of the lists t() is given an
 * element of) is a key, and every t() call is one of those; every locale is one of the Store's
 * languages with the oap-sdk's text file names, and has a translation of every key with the same
 * {n} placeholders and no other; src/locales.js is as the tool writes it; every HMI display
 * language has one locale or English; the HMI's display language picks the locale, English for
 * any other; a word a language lacks is its English; arguments are data.
 *
 *   node tools/test_i18n.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const SRC = path.join(HERE, 'src');
const locales = require('./gen_locales.js');
const i18n = require(path.join(SRC, 'i18n.js'));

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert(cond, msg); };
const eq = (got, want, msg) => { checks += 1; assert.deepStrictEqual(got, want, msg); };

/* ---- the words the app shows ---- */
const used = new Set();
const literal = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/g;
// t() given an element of a list: the list's words are keys
const DYNAMIC = {
    'waze_cluster_control.js': ['t(RESTART_FAILED[r.code] || RESTART_FAILED.error)'],
    'logs_control.js': ['t(ERRORS[s.error] || ERRORS.failed)'],
    // (the match ends at the first ')': HUD_STATES[hud.state()] reads as its start)
    'main.js': ['t(s._en.label)', 't(s._en.options[i])', 't(text)', 't(text)', 't(text)', 't(text)', 't(HUD_STATES[hud.state()',
        't(CATALOG_ERRORS[f.error] || CATALOG_ERRORS.unreadable)', 't(p)']
};
const MODULES = ['src/waze_cluster_control.js', 'src/logs_control.js', 'app/main.js'];
MODULES.forEach((m) => {
    const name = path.basename(m);
    const s = fs.readFileSync(path.join(HERE, m), 'utf8');
    let x;
    while ((x = literal.exec(s))) {
        used.add(x[2].replace(/\\'/g, '\''));
    }
    const other = (s.match(/\bt\((?!\s*['"])[^)]*\)/g) || []);
    eq(other, DYNAMIC[name] || [], `${name}: every t() of a word not written out is a known list's`);
});
Object.values(require(path.join(SRC, 'waze_cluster_control.js')).RESTART_FAILED).forEach((w) => used.add(w));
Object.values(require(path.join(SRC, 'logs_control.js')).ERRORS).forEach((w) => used.add(w));
// app/main.js's lists t() is given an element of (read from its source: it needs the kit to run)
const MAIN = fs.readFileSync(path.join(HERE, 'app', 'main.js'), 'utf8');
const list = (name) => {
    const m = new RegExp(`const ${name} = (\\[[^\\]]*\\]|\\{[^}]*\\});`).exec(MAIN);
    assert(m, `app/main.js: ${name}`);
    const v = Function(`return ${m[1]};`)();
    return Array.isArray(v) ? v : Object.values(v);
};
['PAGES', 'HUD_STATES', 'CATALOG_ERRORS'].forEach((n) => list(n).forEach((w) => used.add(w)));
// the Display page's switches and readings: [setting or value, words]
['HUD_ITEMS', 'HUD_DATA'].forEach((n) => Function(`return ${new RegExp(`const ${n} = (\\[[\\s\\S]*?\\]\\]);`).exec(MAIN)[1]};`)().forEach((it) => used.add(it[1])));
['Cluster', 'HUD', 'Cluster + HUD', 'Test left', 'Test right'].forEach((w) => { ok(MAIN.indexOf(`'${w}']`) >= 0, `app/main.js: ${w}`); used.add(w); });
// the settings' labels and choices (translated at a language change), and the HMI's strings the kit writes
const APP = JSON.parse(fs.readFileSync(path.join(HERE, 'app', 'app.json'), 'utf8'));
APP.settings.forEach((s) => { used.add(s.label); (s.options || []).forEach((o) => used.add(o[1])); });
APP.screens.forEach((sc) => (sc.buttons || []).forEach((b) => used.add(b[1])));
used.add(APP.title);
ok(used.size > 40, `the app's words (${used.size})`);
['Status: {0}', 'Patched', 'Restart: {0}', 'the head unit stayed on', 'Not enough space', 'HUD map: {0}', 'Brightness: {0}', 'Maps',
    'Turn signals on the HUD', 'Cluster functions', 'Settings', 'nothing to show']
    .forEach((w) => ok(used.has(w), `"${w}" is a key`));

// WOC_I18N_WORDS=1: print the words and stop (for translating them)
if (process.env.WOC_I18N_WORDS) {
    console.log(JSON.stringify(Array.from(used)));
    process.exit(0);
}

/* ---- each locale ---- */
// the oap-sdk's text file of each HMI display language (CommonTypesConverters LANGUAGE_SOMEIP_TO_TS_MAP)
const SDK_TEXTS = {
    ARABISCH: 'ar_AE', CHINESISCH_SIMPLE: 'zh_CN', CHINESISCH_TRADITIONELL: 'zh_TW', DAENISCH: 'da_DK', DEUTSCH: 'de_DE',
    ENGLISCH__UK: 'en_GB', ENGLISCH__US: 'en_US', FINNISCH: 'fi_FI', FLAEMISCH: 'nl_BE', FRANZOESISCH: 'fr_FR',
    FRANZOESISCH__CA: 'fr_CA', GRIECHISCH: 'el_GR', HEBRAEISCH_IVRIT: 'he_IL', INDONESISCH: 'id_ID', ITALIENISCH: 'it_IT',
    JAPANISCH: 'ja_JP', KANTONESISCH_SIMPLE: 'zh_yue_Hans_CN', KANTONESISCH_TRADITIONELL: 'zh_yue_Hant_CN', KOREANISCH: 'ko_KR',
    NIEDERLAENDISCH: 'nl_NL', NORWEGISCH: 'no_NO', POLNISCH: 'pl_PL', PORTUGIESISCH: 'pt_PT', PORTUGIESISCH__BR: 'pt_BR',
    RUMAENISCH: 'ro_RO', RUSSISCH: 'ru_RU', SCHWEDISCH: 'sv_SE', SLOWAKISCH: 'sk_SK', SLOWENISCH: 'sl_SI', SPANISCH: 'es_ES',
    SPANISCH__US: 'es_MX', THAI: 'th_TH', TSCHECHISCH: 'cs_CZ', TUERKISCH: 'tr_TR', UKRAINISCH: 'uk_UA', UNGARISCH: 'hu_HU',
    VIETNAMESISCH: 'vi_VN'
};
// the Store's languages (mgu-store apps/robertn_store/locales)
const CODES = ['ar', 'cs', 'da', 'de', 'el', 'es', 'es-US', 'fi', 'fr', 'fr-CA', 'he', 'hu', 'id', 'it', 'ja', 'ko', 'nb', 'nl',
    'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW'];
const placeholders = (s) => (s.match(/\{\d+\}/g) || []).sort();
const all = locales.read();
eq(all.map((l) => l.code).sort(), CODES.slice().sort(), 'the Store\'s languages');
eq(fs.readFileSync(locales.OUT, 'utf8'), locales.source(), 'src/locales.js as tools/gen_locales.js writes it');
eq(i18n.codes(), all.map((l) => l.code), 'every locale in the app');
const untranslated = [];
all.forEach((l) => {
    const n = `${l.code}.json`;
    ok(Array.isArray(l.hmiLanguages) && l.hmiLanguages.length && l.hmiLanguages.every((h) => SDK_TEXTS[h]), `${n}: hmiLanguages`);
    eq(l.rhmiTexts, l.hmiLanguages.map((h) => SDK_TEXTS[h]), `${n}: rhmiTexts, the oap-sdk's file of each of its HMI languages`);
    eq(Object.keys(l).sort(), ['code', 'hmiLanguages', 'rhmiTexts', 'words'], `${n}: hmiLanguages, rhmiTexts, words`);
    Object.keys(l.words).forEach((k) => {
        ok(typeof l.words[k] === 'string' && l.words[k].trim() !== '', `${n}: "${k}" is translated`);
        eq(placeholders(l.words[k]), placeholders(k), `${n}: "${k}" has the placeholders of its English`);
        ok(!/[​-‏‪-‮⁠-⁤⁦-⁩﻿]/.test(l.words[k]), `${n}: "${k}" has no hidden characters`);
        eq(l.words[k], l.words[k].normalize('NFC'), `${n}: "${k}" is NFC`);
    });
    eq(Object.keys(l.words).filter((k) => !used.has(k)), [], `${n}: translations of words the app does not show`);
    const missing = Array.from(used).filter((k) => !Object.prototype.hasOwnProperty.call(l.words, k));
    if (missing.length) {
        untranslated.push(`${n}: ${missing.length} of ${used.size} words without a translation`);
    }
});
// every HMI display language: English or one locale's, with its text file
const covered = ['ENGLISCH__UK', 'ENGLISCH__US'].concat(...all.map((l) => l.hmiLanguages));
eq(covered.slice().sort(), Object.keys(SDK_TEXTS).sort(), 'every HMI display language, once');

/* ---- the glyphs: every character a drawn language's words have, in the atlas that draws it (app/main.js useFonts) ---- */
const ATLAS = { vi: 'vietnamese', el: 'greek', ru: 'cyrillic', uk: 'cyrillic', 'zh-CN': 'cjk-sc', 'zh-TW': 'cjk-tc', ja: 'japanese', ko: 'korean' };
const DRAWN_ENGLISH = ['ar', 'he', 'th'];
const glyphs = {};
const atlas = (fam) => glyphs[fam] || (glyphs[fam] = JSON.parse(fs.readFileSync(path.join(HERE, 'fonts', `woc-${fam}.json`), 'utf8')).sizes);
all.filter((l) => DRAWN_ENGLISH.indexOf(l.code) < 0).forEach((l) => {
    const text = Object.values(l.words).join('') + Object.values(l.words).map((w) => w.toUpperCase()).join('');
    ['', '-bold'].forEach((weight) => atlas((ATLAS[l.code] || 'latin') + weight).forEach((size) => {
        const missing = Array.from(new Set(Array.from(text))).filter((ch) => ch.codePointAt(0) >= 32 && !size.glyphs[ch.codePointAt(0)]);
        eq(missing, [], `${l.code}: every character in woc-${ATLAS[l.code] || 'latin'}${weight} at ${size.size} px (tools/bake_fonts.py)`);
    }));
});
ok(MAIN.indexOf(`const DRAWN_ENGLISH = ${JSON.stringify(DRAWN_ENGLISH).replace(/"/g, "'").replace(/,/g, ', ')};`) >= 0, 'app/main.js draws ar, he and th in English');

/* ---- the display language ---- */
const LIVE = require(path.join(SRC, 'locales.js'));
const de = LIVE.find((l) => l.code === 'de');
const deWords = de.words;
de.words = { 'Status: {0}': 'Zustand: {0}', Patched: 'Gepatcht', 'Possible in {0} min': 'Möglich in {0} Min.' };
eq(i18n.language(), 'en', 'English at first');
eq(i18n.t('Status: {0}', i18n.t('Patched')), 'Status: Patched', 'English with its arguments');
ok(i18n.setHmiLanguage('DEUTSCH'), 'German: a change');
eq(i18n.language(), 'de', 'DEUTSCH: de');
ok(!i18n.setHmiLanguage('DEUTSCH'), 'the same language: no change');
eq(i18n.t('Status: {0}', i18n.t('Patched')), 'Zustand: Gepatcht', 'the name and the value each translated');
eq(i18n.t('Status: {0}', '{1} Failed'), 'Zustand: {1} Failed', 'arguments are data');
eq(i18n.t('Possible in {0} min', 8), 'Möglich in 8 Min.', 'a number in its place');
eq(i18n.t('Zoom out'), 'Zoom out', 'a word the language lacks: its English');
eq(i18n.t('Not a word the app has'), 'Not a word the app has', 'an unknown word: itself');
[['FLAEMISCH', 'nl'], ['KANTONESISCH_SIMPLE', 'zh-CN'], ['KANTONESISCH_TRADITIONELL', 'zh-TW'], ['PORTUGIESISCH__BR', 'pt-BR'],
    ['SPANISCH__US', 'es-US'], ['FRANZOESISCH__CA', 'fr-CA'], ['NORWEGISCH', 'nb'], ['ARABISCH', 'ar']].forEach(([h, code]) => {
    i18n.setHmiLanguage(h);
    eq(i18n.language(), code, `${h}: ${code}`);
});
['ENGLISCH__UK', 'ENGLISCH__US', 'SIGNAL_UNGUELTIG', 'KEINE_SPRACHE', 'KLINGONISCH', 11, null, undefined, {}].forEach((v) => {
    i18n.setHmiLanguage('DEUTSCH');
    ok(i18n.setHmiLanguage(v), `${JSON.stringify(v)}: a change`);
    eq([i18n.language(), i18n.t('Status: {0}', i18n.t('Patched'))], ['en', 'Status: Patched'], `${JSON.stringify(v)}: English`);
});
de.words = deWords;

console.log(`i18n: ${all.length} locales, ${used.size} words, ${checks} checks pass`);
assert(!untranslated.length, `every locale needs a translation of every word:\n  ${untranslated.join('\n  ')}`);
console.log('i18n: every locale has every word');
