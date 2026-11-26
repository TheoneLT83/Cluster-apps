# Changelog

## Unreleased

## 0.14.19

The CarPlay patch applies with CarPlay multitouch on: its carplay no longer reads as another program, so the cluster
map shows with two-finger touch kept.

## 0.14.18

Each log save measures perf.txt then (the one from when the Log page opened is perf-open.txt): a second save no longer
repeats the first's. An app's process whose folder the logs service cannot read shows as node(uid <n>); the root
report lists the apps by uid, which also names the load lines' processes.

## 0.14.17

The log export has perf.txt: what used the head unit's CPU and memory over 3 s when the Log page opened - the load
and pressure, the busiest processes by app (named from their uid's app folder) and systemd unit, their busiest
threads, the most memory, and each node process's app. The load line kept every 30 s names an app's process by its
app (app:<name>, it was node) and lists the busiest 8.

## 0.14.16

The log export (Cluster functions' Log page) also holds this boot's journal of the Store's services (its renderer,
updater, uplink, app-privacy, the controller gate, the deploy tool's check), idrive7-apps' renderer and Turn View,
and up to 48 of the apps' own log files.

## 0.14.15

The map service runs in the head unit's slice for standard services, level
with the HMI.

## 0.14.14

robertnisipeanu/idrive-apps' 0.14.13 and 0.14.14 with this repository's 0.14.13:

Android Auto: Patch, Remove patch, Zoom and the turn card take effect at
the next head-unit start (**Restart head unit**), so Android Auto's
touchscreen and iDrive controller keep working after them. Several can be
changed before that restart; changing one back to what already runs leaves
nothing waiting.


The patch and recovery services run in the head unit's slice for standard
services, and the journal keeper in its slice for background work, so none
of them takes CPU time ahead of the HMI.

## 0.14.13

robertnisipeanu/idrive-apps' 0.14.12 with this repository's 0.14.12: the tests build with the cluster renderer's
iDrive 7 log-level handling left out, as the map feed test does not use it. Nothing changes on the car.

## 0.14.12

robertnisipeanu/idrive-apps' 0.14.11 with this repository's 0.14.11:

The map's frames go to the cluster renderer through shared memory where
the renderer takes them, which takes less CPU for each frame. The receive
and decode threads wait without waking while no stream comes.

## 0.14.11

robertnisipeanu/idrive-apps' 0.14.10 with this repository's 0.14.10: the tests run at once (`make test` in about a
minute and a half instead of about 18, with the same checks). Nothing changes on the car.

## 0.14.10

robertnisipeanu/idrive-apps' 0.14.7 to 0.14.9 with this repository's 0.14.7:

Building from source retries a failed package download and shows its
error.

The tests remove their temporary files and stop the processes they start
however a run ends, also when it fails or is interrupted.

CarPlay's cluster map works on cars where removing or updating
another CarPlay safe-area tool left `Changed by another tool`; restart the
head unit after updating.

## 0.14.7

The rollback tests read this repository's release tags (its first, 0.9.2) and check a separate capture unit only
for the releases before 0.14.6. Nothing changes on the car.

## 0.14.6

Uses about 10 MB less of the head unit's memory: the diagnostic DLT
capture now runs inside the patch service instead of a service of its own.
Boot recovery and the journal keeper stay separate.

## 0.14.5

A cluster theme app that draws with layers only can show the map inside its
theme, under its frame and readouts, with a cluster-render release after 0.8.1. The
map goes back to its own place when the theme hides, ends it or exits.
The map's layer says it is the hosted map, so the theme's frame stays over
it. A host whose place the map cannot be drawn in leaves the map in its
own place. Nothing else changes.

## 0.14.4

The rollback and Android Auto tests pass when run side by side or on a busy
machine, and the rollback test also checks this version as the release it
becomes.

## 0.14.3

The patch checks the places it edits, not the whole file: a carplay or
aapd of a known version whose file differs only elsewhere, as on another
firmware image, gets the cluster map like any other. Save logs shows which
part of such a file differs.
A patch you removed with Remove patch stays removed after a car software
update too, until you press Patch. A version whose patch fails its own
check is not tried again at each head-unit start.

## 0.14.2

Installing or updating turns the CarPlay and Android Auto map patches on
by itself for every car software version it can check, with no Patch press
and no more `Untested version`; a version new to your car is removed again
by itself if the head unit then fails to start. A patch you removed stays
removed.

## 0.14.1

The Wi-Fi band test waits for each sample to finish, so it passes on a
busy machine too.

## 0.14.0

Android Auto: the cluster map starts at every connection, also after you
leave the car and get back in, without a route planned.

## 0.13.0

Android Auto's cluster map patch is applied in aapd's memory each time it
starts, as CarPlay's is: `/usr/bin/aapd` and `/etc/aapd.conf` stay as they
ship. Updating from an earlier version puts the original files back and
keeps the map, your zoom and turn-card settings included.

## 0.12.1

The rollback tests treat 0.11.0 and later as releases that patch CarPlay in
memory.
A map shown inside another app's scene on the cluster appears as soon as
its picture is ready, including when that app shows it again while the map
is still.

## 0.12.0

While another app's content on the cluster asks for upload bandwidth
(cluster-render's `others_fps`), the map runs at the lower frame rate it
asks for and makes no more pictures than that, and goes back to its own
rate when that app hides its content or exits.

## 0.11.0

robertnisipeanu/idrive-apps' 0.10.12 and 0.11.0 with this repository's 0.10.17:

- CarPlay's cluster map patch is applied in CarPlay's memory each time it
  starts, and `/usr/bin/carplay` stays as it ships: no write of the system
  partition to patch, remove or recover it. Updating from an earlier version
  puts the original file back and keeps the map, with at most one head-unit
  restart; where CarPlay already runs the earlier patch, none.
- The diagnostic journal is kept in memory and written to storage only
  around failures and at shutdown, which greatly reduces writes to the head
  unit's storage.

