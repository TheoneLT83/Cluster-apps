#!/bin/sh
# Starts mgu-drplay for Cluster-apps' Drive recorder (TheoneLT83's change; the player itself is IterioDev's, unchanged).
# mgu-drplay answers only the app whose user id it is given (--uid), by default IterioDev's own Drive Recorder's
# (the app manager's oap-driverecorder-next.json). Here: robertn_drive_recorder's, from its record there; without
# it, IterioDev's app's when that one is installed; with neither (the app is installed after the player), it waits,
# looking every 5 s, so the service is running and healthy meanwhile.
APPS=${DR_APPS:-/var/opt/public/oap/oap_12201/data/apps}
BIN=${DR_BIN:-/var/opt/iteriodev-drplay/current/mgu-drplay}
uid_of() { [ -f "$1" ] && sed -n 's/.*"userId"[^0-9]*\([0-9][0-9]*\).*/\1/p' "$1" | head -n 1; }
said=
while :; do
    U=$(uid_of "$APPS/robertn_drive_recorder.json")
    if [ -n "$U" ]; then exec "$BIN" --uid "$U"; fi
    if [ -f "$APPS/oap-driverecorder-next.json" ]; then exec "$BIN"; fi
    [ -n "$said" ] || { echo "drplay-start: no Drive recorder installed yet, waiting" >&2; said=1; }
    sleep "${DR_WAIT_S:-5}"
done
