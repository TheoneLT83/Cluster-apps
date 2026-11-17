#!/bin/sh
# Starts mgu-drplay for Cluster-apps' Drive recorder (TheoneLT83's change; the player itself is IterioDev's, unchanged).
# mgu-drplay answers only the app whose user id is in the app manager's oap-driverecorder-next.json (IterioDev's own
# Drive Recorder; a path fixed in the player), and drops to uid 3912 (--uid N: to uid N instead, not the app's).
# With robertn_drive_recorder installed it runs in a mount namespace of its own where that folder of records is
# REC, holding one oap-driverecorder-next.json with robertn_drive_recorder's user id; nothing else sees it. Without
# it, IterioDev's app's when that one is installed. It ends at once without a clip folder ("no clip folders / bad uid":
# a car whose camera service has made none yet). Until there are an app and a clip folder it waits, looking every
# DR_WAIT_S s; a player that ends is started again RETRY_S s later, each end in the journal.
# The service stays running meanwhile, so an install is not taken back for a car that cannot record yet; the reason
# is in STATE for the app.
APPS=${DR_APPS:-/var/opt/public/oap/oap_12201/data/apps}
BIN=${DR_BIN:-/var/opt/iteriodev-drplay/current/mgu-drplay}
# the clip folders the car may have: the player's own two, and /var/opt/hdshare's (a car whose recorder keeps its clips
# there), passed to it as --dirs when there
CLIPS=${DR_CLIPS:-/var/opt/public/ent/driverecorder /mnt/share/ent/driverecorder /var/opt/hdshare/ent/driverecorder}
WAIT_S=${DR_WAIT_S:-5}
RETRY_S=${DR_RETRY_S:-30}
uid_of() { [ -f "$1" ] && sed -n 's/.*"userId"[^0-9]*\([0-9][0-9]*\).*/\1/p' "$1" | head -n 1; }
clips() { [ -n "$(dirs)" ]; }
# a folder the player, once it drops to uid 3912 (groups 929 mgu_driverec, 903 mgu_persist), can list and enter:
# its owner, one of its groups, or anyone with r and x
usable() {
    m=$(stat -c '%a %u %g' "$1" 2>/dev/null) || return 1
    set -- $m
    p=$(printf '%04d' "$1"); o=$(printf '%s' "$p" | cut -c2); g=$(printf '%s' "$p" | cut -c3); a=$(printf '%s' "$p" | cut -c4)
    rx() { [ $(( $1 & 5 )) -eq 5 ]; }
    if [ "$2" = 3912 ]; then rx "$o"; elif [ "$3" = 929 ] || [ "$3" = 903 ]; then rx "$g"; else rx "$a"; fi
}
dirs() { d=; for c in $CLIPS; do [ -d "$c" ] && usable "$c" && d="${d:+$d,}$c"; done; printf '%s' "$d"; }
# why the player is not up, for the Drive recorder app (STATE: one line, anyone may read it; removed while it runs)
RUN=${DR_RUN:-/run/iteriodev-drplay}
REC=${DR_REC:-/var/opt/iteriodev-drplay/app-record}
STATE=${DR_STATE:-/run/iteriodev-drplay/start-state}
ERR=${DR_ERR:-/run/iteriodev-drplay/player.err}
said=
say() { [ "$said" = "$1" ] || { echo "drplay-start: $1" >&2; said=$1; printf '%s\n' "$1" > "$STATE.tmp" 2>/dev/null && chmod 644 "$STATE.tmp" && mv -f "$STATE.tmp" "$STATE"; }; }
while :; do
    U=$(uid_of "$APPS/robertn_drive_recorder.json")
    if [ -z "$U" ] && [ ! -f "$APPS/oap-driverecorder-next.json" ]; then say "no Drive recorder installed yet, waiting"
    elif ! clips; then say "no clip folder yet ($CLIPS), waiting"
    else
        # its socket folder its own again (the player makes drplay.sock there after it drops to uid 3912, group 929;
        # setup.sh does this only at the service's start), and an old socket gone
        mkdir -p "$RUN" && chown 3912:929 "$RUN" && chmod 755 "$RUN"
        rm -f "$RUN/drplay.sock"
        rm -f "$STATE"; said=
        # (its errors kept in ERR as well as in the journal: the last line says why it ended)
        if [ -n "$U" ]; then
            mkdir -p "$REC" && printf '{"userId": %s}\n' "$U" > "$REC/oap-driverecorder-next.json" &&
                unshare -m sh -c 'mount --make-rprivate / && mount --bind "$1" "$2" && shift 2 && exec "$@"' sh \
                    "$REC" "$APPS" "$BIN" --dirs "$(dirs)" 2>"$ERR"
        else "$BIN" --dirs "$(dirs)" 2>"$ERR"; fi
        rc=$?
        cat "$ERR" >&2 2>/dev/null
        say "the player ended (exit $rc): $(grep -v '^[[:space:]]*$' "$ERR" 2>/dev/null | tail -n 1 | cut -c1-160)"
        sleep "$RETRY_S"
        said=
        continue
    fi
    sleep "$WAIT_S"
done
