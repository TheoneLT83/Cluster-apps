# Turn View in Cluster functions

Turn View is IterioDev's (github.com/IterioDev/car-apps, `tools/iteriodev-turnview` at commit 2e353a0, tool 0.7.0, and
the camera request of its app `iteriodev_turnview` 1.5.0, `src/camreq.js`), under the PolyForm Strict License 1.0.0
in `LICENSE.md`. TheoneLT83 has IterioDev's permission to ship it in Cluster-apps and to change it for Cluster functions.
IterioDev's credits and notices are kept.

Changed here: the tool's id, service, data folder and control socket (`turn-view`, `/var/opt/turn-view`,
`/run/turn-view/ctl.sock`), so it never clashes with IterioDev's own Turn View; the app it starts is Cluster functions
(`robertn_waze_cluster`); iDrive 7 only. `mgu-camcluster` is unchanged (GPL-3.0-or-later: `LICENSE.camcluster`).
