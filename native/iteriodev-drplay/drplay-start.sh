#!/bin/sh
# Starts mgu-drplay for Cluster-apps' Drive recorder (TheoneLT83's change; the player itself is IterioDev's, unchanged).
# mgu-drplay answers only the app whose user id it is given (--uid), by default IterioDev's own Drive Recorder's
# (the app manager's oap-driverecorder-next.json). Here: robertn_drive_recorder's, from its record there; without
# it, IterioDev's app's when that one is installed. It ends at once without a clip folder ("no clip folders / bad uid":
# a car whose camera service has made none yet). Until there are an app and a clip folder it waits, looking every
# DR_WAIT_S s; a player that ends is started again RETRY_S s later, each end in the journal.
# The service stays running meanwhile, so an install is not taken back for a car that cannot record yet.
APPS=${DR_APPS:-/var/opt/public/oap/oap_12201/data/apps}
BIN=${DR_BIN:-/var/opt/iteriodev-drplay/current/mgu-drplay}
CLIPS=${DR_CLIPS:-/var/opt/public/ent/driverecorder /mnt/share/ent/driverecorder}
WAIT_S=${DR_WAIT_S:-5}
RETRY_S=${DR_RETRY_S:-30}
uid_of() { [ -f "$1" ] && sed -n 's/.*"userId"[^0-9]*\([0-9][0-9]*\).*/\1/p' "$1" | head -n 1; }
clips() { for c in $CLIPS; do [ -d "$c" ] && return 0; done; return 1; }
said=
say() { [ "$said" = "$1" ] || { echo "drplay-start: $1" >&2; said=$1; }; }
while :; do
    U=$(uid_of "$APPS/robertn_drive_recorder.json")
    if [ -z "$U" ] && [ ! -f "$APPS/oap-driverecorder-next.json" ]; then say "no Drive recorder installed yet, waiting"
    elif ! clips; then say "no clip folder yet ($CLIPS), waiting"
    else
        if [ -n "$U" ]; then "$BIN" --uid "$U"; else "$BIN"; fi
        say "the player ended (exit $?), again in $RETRY_S s"
        sleep "$RETRY_S"
        said=
        continue
    fi
    sleep "$WAIT_S"
done
