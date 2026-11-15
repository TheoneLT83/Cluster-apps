# Turn View in Cluster functions

Turn View is IterioDev's (github.com/IterioDev/car-apps, `tools/iteriodev-turnview` at commit 2e353a0, tool 0.7.0, and
the camera request of its app `iteriodev_turnview` 1.5.0, `src/camreq.js`), under the PolyForm Strict License 1.0.0
in `LICENSE.md`. TheoneLT83 has IterioDev's permission to ship it in Cluster-apps and to change it for Cluster functions, the camera
binary `mgu-camcluster` included.
IterioDev's credits and notices are kept.

Changed here: the tool's id, service, data folder and control socket (`turn-view`, `/var/opt/turn-view`,
`/run/turn-view/ctl.sock`), so it never clashes with IterioDev's own Turn View; the app it starts is Cluster functions
(`robertn_waze_cluster`), which also keeps the driver's on / off over a start of the car; iDrive 7 only.

`mgu-camcluster` is IterioDev's build, shipped here unchanged with their permission. It is GPL-3.0-or-later as a whole
(`LICENSE.camcluster`: parts of it come from Robert Nisipeanu's waze-on-cluster and cluster-render) and links FFmpeg's
libraries (LGPL-2.1-or-later, `LICENSE.ffmpeg`); its source is IterioDev's, to be had from them.
