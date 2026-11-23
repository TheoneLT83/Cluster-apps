// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Robert Nisipeanu
'use strict';
/**
 * icons.js - the small line icons in front of the switches: draw(cv, name, cx, cy, c), about 24 px across,
 * centred at cx, cy, in colour c. An unknown name draws nothing.
 */
const LW = 2;

const ICONS = {
    // a folded map
    map(cv, x, y, c) {
        cv.polyline([[x - 10, y - 6], [x - 3.5, y - 9], [x + 3.5, y - 6], [x + 10, y - 9], [x + 10, y + 6], [x + 3.5, y + 9],
            [x - 3.5, y + 6], [x - 10, y + 9], [x - 10, y - 6]], LW, c);
        cv.line(x - 3.5, y - 9, x - 3.5, y + 6, LW, c);
        cv.line(x + 3.5, y - 6, x + 3.5, y + 9, LW, c);
    },
    // a roundel, struck through
    guide(cv, x, y, c) {
        cv.arc(x, y, 7.5, 7.5 + LW, 0, 360, c);
        cv.line(x - 9, y + 9, x + 9, y - 9, LW, c);
    },
    // a traffic light
    light(cv, x, y, c) {
        cv.strokeRoundRect(x - 5.5, y - 11, 11, 22, 3, LW, c);
        [-5.5, 0, 5.5].forEach((d) => cv.circle(x, y + d, 2.2, c));
    },
    // the info bar: a box in three
    bar(cv, x, y, c) {
        cv.strokeRoundRect(x - 11, y - 6, 22, 12, 3, LW, c);
        cv.line(x - 3.5, y - 3, x - 3.5, y + 3, LW, c);
        cv.line(x + 3.5, y - 3, x + 3.5, y + 3, LW, c);
    },
    // a camera
    camera(cv, x, y, c) {
        cv.strokeRoundRect(x - 11, y - 7, 22, 15, 3, LW, c);
        cv.arc(x, y + 0.5, 3.5, 3.5 + LW, 0, 360, c);
        cv.fillRect(x - 5, y - 10, 7, 3, c);
    },
    // the windscreen with the picture on it
    hud(cv, x, y, c) {
        cv.polyline([[x - 11, y + 8], [x - 8, y - 8], [x + 8, y - 8], [x + 11, y + 8], [x - 11, y + 8]], LW, c);
        cv.roundRect(x - 4, y - 3, 8, 5, 1, c);
    },
    // both arrows
    turn(cv, x, y, c) {
        cv.quad([[x - 12, y], [x - 4, y - 6], [x - 4, y + 6], [x - 12, y]], c);
        cv.quad([[x + 12, y], [x + 4, y - 6], [x + 4, y + 6], [x + 12, y]], c);
    },
    // the gear lever's D
    gear(cv, x, y, c) {
        cv.strokeRoundRect(x - 10, y - 10, 20, 20, 4, LW, c);
        cv.text('D', x, y + 5, 14, c, { align: 'center', font: 'bold' });
    },
    // a dial with its needle
    speed(cv, x, y, c) {
        cv.arc(x, y + 3, 9, 9 + LW, -120, 120, c);
        cv.line(x, y + 3, x + 5, y - 3, LW, c);
        cv.circle(x, y + 3, 2, c);
    },
    // a crescent moon
    night(cv, x, y, c) {
        cv.arc(x, y, 7, 9, 190, 430, c);
        cv.arc(x + 4.5, y - 4.5, 7, 9, 170, 280, c);
    },
    // one window over another
    layers(cv, x, y, c) {
        cv.strokeRoundRect(x - 10, y - 8, 14, 11, 2, LW, c);
        cv.roundRect(x - 4, y - 2, 14, 11, 2, c);
    },
    // a person
    person(cv, x, y, c) {
        cv.arc(x, y - 4, 4, 4 + LW, 0, 360, c);
        cv.arc(x, y + 11, 8, 8 + LW, -70, 70, c);
    },
};

function draw(cv, name, cx, cy, c) {
    const f = ICONS[name];
    if (f) f(cv, cx, cy, c);
}

module.exports = { draw, ICONS };
