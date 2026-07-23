#!/usr/bin/env python3
"""JSON bridge for the launcher: reuses ~/moonlight/sync-steam-apps.py.

Prints {"games":[{"appid","name","cover","art_src"}]} to stdout. Reusing the
existing module keeps the SKIP_NAME Valve-tools filter, the StateFlags&4 check
and the mandatory JPEG->PNG transcode (Sunshine/Moonlight only render PNG)
single-sourced — do NOT reimplement those in Node.

Flags: --no-art   skip cover fetching (fast refresh; existing covers still used)
"""
import importlib.util
import json
import sys
from pathlib import Path

NO_ART = "--no-art" in sys.argv
SYNC = Path.home() / "moonlight" / "sync-steam-apps.py"

# The sync script reads sys.argv at import time (DRY/NO_ART globals) — make
# sure our flags don't leak into it; we set its globals explicitly instead.
sys.argv = [sys.argv[0]]

spec = importlib.util.spec_from_file_location("sync_steam_apps", SYNC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.DRY = False
mod.NO_ART = NO_ART

games = []
for appid, name in mod.installed_games().items():
    cover_path = mod.COVERS / f"{appid}.png"
    art_src = "cached"
    if not cover_path.exists():
        if NO_ART:
            art_src = "none"
        else:
            try:
                path, art_src = mod.cover(appid)
            except Exception as e:  # network/CDN hiccup must not kill the list
                print(f"cover({appid}) failed: {e}", file=sys.stderr)
                art_src = "error"
    games.append({
        "appid": str(appid),
        "name": name,
        "cover": str(cover_path) if cover_path.exists() else None,
        "art_src": art_src,
    })

json.dump({"games": games}, sys.stdout)
print()
