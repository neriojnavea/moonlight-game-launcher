#!/usr/bin/env bash
# Launch the game launcher inside the X session, from anywhere (incl. SSH).
# Mirrors the env rules from CLAUDE.md §2.3/§2.4: explicit X env, local pulse.
set -u
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-/run/user/1000/gdm/Xauthority}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
export PULSE_SERVER="unix:/run/user/1000/pulse/native"   # never the Mac tunnel

cd "$(dirname "$(readlink -f "$0")")/.." || exit 1
# --no-sandbox: Ubuntu 25.10 blocks unprivileged user namespaces and the SUID
# helper isn't root-owned under node_modules. Local-only kiosk app → acceptable.
# --password-store=basic: keep Electron away from gnome-keyring (no unlock prompts).
exec ./node_modules/.bin/electron . --no-sandbox --password-store=basic "$@" \
    >>/run/user/1000/launcher-stdout.log 2>&1
