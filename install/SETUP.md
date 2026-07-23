# Game Launcher — setup & operations

## One-time setup (state as of 2026-07-22: all DONE except the Steam setting)

1. **Dependencies** — `cd ~/moonlight/launcher && npm install` (needs network).
   Electron is pinned in `package.json`. ✅ done
2. **Autostart** — `cp install/game-launcher.desktop ~/.config/autostart/`.
   Starts 10s after login, after Sunshine's own autostart. ✅ done
3. **Sunshine app entry** — a "Game Launcher" entry exists in
   `~/.config/sunshine/apps.json` (runs `launcher.sh --activate`, which pokes the
   already-running instance to show itself). **Restart Sunshine (CLAUDE.md §3) to
   make it appear in Moonlight** — do this when no stream is active. ✅ entry added
4. **⚠️ MANUAL — disable Steam's guide-button binding.** In Steam (Big Picture:
   Settings → Controller): turn OFF *"Open Steam Home when the Guide button is
   pressed"* (a.k.a. "Guide button focuses Steam"). Until you do, a guide press
   opens BOTH our overlay and Steam Big Picture, and Steam steals focus.

## Daily driving

- **Connect to Desktop** in Moonlight → the launcher is what you land in.
- **A / Cross** = play (smart: launches, resumes, or refocuses as appropriate).
- **Single-game mode (default ON, `singleGameMode`):** only one game runs at a
  time. Starting a *different* game while one is open (running OR suspended)
  pops a confirm — on OK the other game is **hard-closed** before the new one
  starts. This avoids stacking VRAM across games (an RTX 3070 has 8 GB; two big
  games can starve Sunshine's encoder and make Moonlight time out). Turn it off
  in `config.json` to get the old Xbox-style behaviour instead (launching B
  **suspends** A, kept via `autoSuspendOnSwitch`).
- **Live resource monitor** (CPU / RAM / GPU / VRAM / temp) shows in the library
  top bar and the in-game overlay, so you can see at a glance if VRAM is filling
  up.
- **X / Square** on a running game = suspend. **Y / Triangle** = close (confirm
  dialog; a parked game is woken first, then asked to quit — never killed
  without an explicit "Force kill" confirmation).
- **Guide button in-game** = overlay: Return / Suspend & Library / Switch to… /
  Close.
- **View+Menu (Select+Start) or F12** = Debug screen: live state table, log
  tails (launcher/suspend/sunshine), input device list + live event viewer
  (controller tester), rescue actions (resume-all, resync, **restart launcher**,
  **quit launcher**).
- Keyboard works everywhere: arrows / Enter / Esc / S=suspend / X=close / Q/E=tabs / F12.

## Starting / quitting the launcher

- **Quit:** Debug screen → Actions → *Quit launcher* (games keep running), or
  `launcherctl quit`.
- **Start it again:**
  - The **Game Launcher** icon on the XFCE desktop (double-click).
  - The **Game Launcher** tile in Moonlight (once Sunshine is restarted so the
    app entry appears).
  - Terminal: `~/moonlight/launcher/bin/launcher.sh &`
  - It also autostarts on login.

## Controller input note

All controller input is read straight from `/dev/input` in the main process
(`main/evdev.js` + `main/padmap.js`), NOT the browser Gamepad API — the Gamepad
API goes blind the moment Steam Input attaches to a pad. If the controller ever
feels dead in the UI, open Debug → Input to see live events and which device is
firing.

## CLI (same code path as the UI — safe to mix)

```
~/moonlight/launcher/bin/launcherctl ping|status|frozen|resume-all
~/moonlight/launcher/bin/launcherctl launch|play|suspend|resume|close|force-kill <appid>
~/moonlight/launcher/bin/launcherctl resume            # no appid = last parked
~/moonlight/launcher/bin/launcherctl show|hide|resync|quit
```

## Restarting / recovering

- Restart launcher: Debug → Actions → Restart launcher, or
  `launcherctl quit; setsid ~/moonlight/launcher/bin/launcher.sh &` (from SSH it
  sets its own X env). Parked games survive a launcher crash/restart — state
  lives in `/run/user/1000/sunshine-susp-*` and is re-derived on start.
- Everything frozen and confused? `~/moonlight/gamectl resume-all` still works
  (it's the same machinery).

## Testing

- Unit tests (no X/Steam needed): `cd ~/moonlight/launcher && npm test`
- Full quick-resume suite through the launcher (needs 2 running games +
  launcher up): `./test/test-launcher-quick-resume.sh <appidA> <appidB>`
  Last run 2026-07-22: **30/30**, and the original
  `~/moonlight/test-quick-resume.sh` still passes 30/30 (scripts untouched).

## Notes / quirks

- Electron runs with `--no-sandbox` (Ubuntu 25.10 blocks unprivileged user
  namespaces; local-only kiosk app) and `--password-store=basic` (avoids
  gnome-keyring unlock prompts).
- Logs: `/run/user/1000/launcher.log` (app) and
  `/run/user/1000/launcher-stdout.log` (Electron stderr/stdout). Both tmpfs.
- Config: `~/moonlight/launcher/config.json` (merged over
  `config.default.json`); editable live from the Debug screen or by hand.
- Box art comes from `~/moonlight/covers/<appid>.png` via `sync-steam-apps.py`'s
  functions (the launcher never duplicates that logic).
