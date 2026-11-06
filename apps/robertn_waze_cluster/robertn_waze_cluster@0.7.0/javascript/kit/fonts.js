'use strict';
/**
 * fonts.js - loads the pre-baked glyph atlases (kit/runtime/fonts/*.json,
 * made by kit/tools/bake_fonts.py) and picks the best size for a request.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.join(__dirname, 'fonts');
const families = Object.create(null);

function family(name) {
    if (families[name] !== undefined) return families[name];
    let fam = null;
    try {
        const j = JSON.parse(fs.readFileSync(path.join(DIR, name + '.json'), 'utf8'));
        fam = j.sizes.map((s) => ({
            size: s.size, ascent: s.ascent, descent: s.descent, atlasW: s.atlasW, atlasH: s.atlasH,
            glyphs: s.glyphs, _alpha: s.alpha, alpha: null, family: name, cacheKey: j.cacheKey || '',
        }));
    } catch (e) { fam = null; }
    families[name] = fam;
    return fam;
}

/* The supplemental atlas of each script; an app names its own (useScripts), e.g. the Chinese or Japanese one for
 * the language in use. A script's '<family>-bold' atlas, where there is one, draws bold text. */
const SCRIPTS = { korean: 'korean', cjk: 'cjk', cyrillic: 'cyrillic', greek: null, latin: null };
function useScripts(m) { Object.assign(SCRIPTS, m); }
function script(text) {
    if (!text) return null;
    if (/[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7ff]/.test(text)) return SCRIPTS.korean;
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(text)) return SCRIPTS.cjk;
    if (/[\u0400-\u04ff]/.test(text)) return SCRIPTS.cyrillic;
    if (/[\u0370-\u03ff]/.test(text)) return SCRIPTS.greek;
    if (/[\u00c0-\u024f\u1e00-\u1eff]/.test(text)) return SCRIPTS.latin;
    return null;
}
/** Smallest baked size >= requested (downscaling looks better), else largest. */
function get(name, size, text) {
    // Shared supplemental atlases avoid duplicating glyphs in every numeric size.
    const sup = script(text);
    if (sup) name = name === 'bold' && family(sup + '-bold') ? sup + '-bold' : sup;
    const fam = family(name) || family('label');
    if (!fam) return null;
    let best = null;
    for (const f of fam) if (f.size >= size && (!best || f.size < best.size)) best = f;
    if (!best) best = fam[fam.length - 1];
    if (!best.alpha) best.alpha = zlib.inflateSync(Buffer.from(best._alpha, 'base64'));
    return best;
}

function measure(f, s) {
    let w = 0;
    for (const ch of s) { const g = f.glyphs[ch.codePointAt(0)] || f.glyphs[63]; if (g) w += g[6]; }
    return w;
}

module.exports = { get, measure, useScripts };
