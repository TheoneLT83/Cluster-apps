# Drive Recorder player (iteriodev-drplay)

IterioDev's Drive Recorder player (github.com/IterioDev/car-apps, `tools/iteriodev-drplay` 1.2.6, at commit 2e353a0),
under the PolyForm Strict License 1.0.0 in `LICENSE.md`. TheoneLT83 has IterioDev's permission to ship it here, with the
Drive recorder app (`apps/robertn_drive_recorder`), which also uses IterioDev's app modules `recorder.js`, `player.js` and
`meta.js` (Drive Recorder 2.5.0) unchanged. IterioDev's credits and notices are kept; the app names them in its
Settings tab.

Changed here: `drplay-start.sh` (new) starts the player with `--uid` set to Drive recorder's user id (the player
answers one app only, by default IterioDev's); `iteriodev-drplay.service` runs it. Version 1.2.11 here.

Shipped unchanged: the binaries `mgu-drplay` and `mgu-driverec-rx` (IterioDev's builds; they link FFmpeg, libjpeg-turbo
and OpenH264, see their LICENSE files), the scripts and the services. Its id stays `iteriodev-drplay` (its folders and
sockets are built into the binaries), so a car that has it from IterioDev's own source keeps that one.
