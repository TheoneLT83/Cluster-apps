#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""The app's supplemental glyph atlases (fonts/woc-<script>[-bold].json, the kit's format, kit/runtime/fonts.js):
the characters of every word of the languages the drawn screens show (locales/*.json), in their capitals too,
with the ASCII range, so a line in that script draws whole from one atlas.

  latin       cs da de es es-US fi fr fr-CA hu id it nb nl pl pt pt-BR ro sk sl sv tr   Ubuntu, narrowed to 85 %
  greek       el                                                                     as the kit's Ubuntu (wdth 85)
  cyrillic    ru uk
  vietnamese  vi       Noto Sans at width 87.5 (Ubuntu has no Vietnamese)
  cjk-sc    zh-CN    Noto Sans SC         japanese  ja    Noto Sans JP
  cjk-tc    zh-TW    Noto Sans TC         korean    ko    Noto Sans KR

ar, he and th are drawn in English (they need shaping or right-to-left the kit does not have); their words show on
the tile and the HMI's own screens. Needs Pillow and the fonts (Ubuntu-Regular.ttf, Ubuntu-Bold.ttf from the
Ubuntu font family, NotoSans[wdth,wght].ttf and NotoSans{SC,TC,JP,KR}[wght].ttf from Google Fonts) in FONTDIR:

  python3 tools/bake_fonts.py <fontdir>
"""
import base64, json, os, sys, zlib
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(HERE, 'fonts')
ASCII = ''.join(chr(c) for c in range(32, 127)) + '°·–—…×→←’'
SIZES = [24, 32]
SCRIPTS = {
    'latin': (['cs', 'da', 'de', 'es', 'es-US', 'fi', 'fr', 'fr-CA', 'hu', 'id', 'it', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'sk', 'sl',
               'sv', 'tr'], ('Ubuntu-Regular.ttf', None), ('Ubuntu-Bold.ttf', None), 0.85),
    'vietnamese': (['vi'], ('NotoSans[wdth,wght].ttf', (400, 87.5)), ('NotoSans[wdth,wght].ttf', (700, 87.5)), 1),
    'greek': (['el'], ('Ubuntu-Regular.ttf', None), ('Ubuntu-Bold.ttf', None), 0.85),
    'cyrillic': (['ru', 'uk'], ('Ubuntu-Regular.ttf', None), ('Ubuntu-Bold.ttf', None), 0.85),
    'cjk-sc': (['zh-CN'], ('NotoSansSC[wght].ttf', 400), ('NotoSansSC[wght].ttf', 700), 1),
    'cjk-tc': (['zh-TW'], ('NotoSansTC[wght].ttf', 400), ('NotoSansTC[wght].ttf', 700), 1),
    'japanese': (['ja'], ('NotoSansJP[wght].ttf', 400), ('NotoSansJP[wght].ttf', 700), 1),
    'korean': (['ko'], ('NotoSansKR[wght].ttf', 400), ('NotoSansKR[wght].ttf', 700), 1),
}


def load(fontdir, spec, size):
    f = ImageFont.truetype(os.path.join(fontdir, spec[0]), size)
    if spec[1]:
        f.set_variation_by_axes(list(spec[1]) if isinstance(spec[1], tuple) else [spec[1]])
    return f


def bake(font, size, charset, narrow):
    """One size: glyphs drawn at the size, narrowed horizontally by `narrow`, shelf-packed into a 1024-wide atlas."""
    ascent, descent = font.getmetrics()
    imgs = []
    for ch in charset:
        bbox = font.getbbox(ch, anchor='ls')
        adv = font.getlength(ch) * narrow
        w, h = max(0, bbox[2] - bbox[0]), max(0, bbox[3] - bbox[1])
        im = None
        if w and h:
            im = Image.new('L', (w, h), 0)
            ImageDraw.Draw(im).text((-bbox[0], -bbox[1]), ch, font=font, fill=255, anchor='ls')
            if narrow != 1:
                im = im.resize((max(1, round(w * narrow)), h), Image.LANCZOS)
        imgs.append((ch, im, (round(bbox[0] * narrow), bbox[1]), adv))
    W, x, y, rowh, place = 1024, 0, 0, 0, {}
    for ch, im, _, _ in imgs:
        if im is None:
            place[ch] = (0, 0, 0, 0)
            continue
        if x + im.width > W:
            x, y, rowh = 0, y + rowh + 1, 0
        place[ch] = (x, y, im.width, im.height)
        x += im.width + 1
        rowh = max(rowh, im.height)
    H = y + rowh + 1
    atlas = Image.new('L', (W, H), 0)
    glyphs = {}
    for ch, im, (ox, oy), adv in imgs:
        px, py, pw, ph = place[ch]
        if im is not None:
            atlas.paste(im, (px, py))
        glyphs[ord(ch)] = [px, py, pw, ph, ox, oy, round(adv, 2)]
    return {'size': size, 'ascent': ascent, 'descent': descent, 'atlasW': W, 'atlasH': H,
            'alpha': base64.b64encode(zlib.compress(atlas.tobytes(), 9)).decode(), 'glyphs': glyphs}


def main():
    fontdir = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(OUT, exist_ok=True)
    for script, (codes, regular, bold, narrow) in SCRIPTS.items():
        text = ASCII
        for c in codes:
            words = json.load(open(os.path.join(HERE, 'locales', c + '.json'), encoding='utf-8'))['words'].values()
            text += ''.join(words) + ''.join(w.upper() for w in words)
        charset = ''.join(sorted(set(ch for ch in text if ord(ch) >= 32)))
        for weight, spec in (('', regular), ('-bold', bold)):
            fam = 'woc-' + script + weight
            data = {'family': fam, 'source': spec[0], 'cacheKey': fam + ':' + str(len(charset)),
                    'sizes': [bake(load(fontdir, spec, s), s, charset, narrow) for s in SIZES]}
            p = os.path.join(OUT, fam + '.json')
            json.dump(data, open(p, 'w', encoding='utf-8', newline='\n'), separators=(',', ':'), sort_keys=True)
            print(f'{fam}: {len(charset)} characters -> {os.path.getsize(p) // 1024} KiB')


if __name__ == '__main__':
    main()
