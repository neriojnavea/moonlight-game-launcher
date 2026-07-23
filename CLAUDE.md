# CLAUDE.md — Moonlight Game Launcher

Agent-facing operational contract for this repo. Read this before changing
anything; the invariants below were each learned from a real failure.
Human-facing docs: [`README.md`](./README.md) (overview/architecture) and
[`install/SETUP.md`](./install/SETUP.md) (ops manual). Origin story and the
failed first design this replaces: [`docs/QUICK-RESUME-HISTORY.md`](./docs/QUICK-RESUME-HISTORY.md).
Host machine context: [`docs/HOST.md`](./docs/HOST.md).

## 1. What this is

A fullscreen Electron kiosk app that replaces Steam Big Picture on a **headless
Sunshine game-streaming host** (Ubuntu 25.10, XFCE on **Xorg**, RTX 3070,
streamed to Moonlight clients over Tailscale). It owns **suspend/resume of
games** (SIGSTOP-based "quick resume"), a Guide-button in-game overlay, a
controller-navigable Debug screen, and a live resource monitor.

It does NOT reimplement the pause machinery — it drives the host's proven
scripts (`~/moonlight/suspend-game.sh`, `resume-game.sh`, `gamectl`,
`sync-steam-apps.py`), which live in the parent project, not this repo.

## 2. Invariants — break one and processes get stranded frozen

1. **Exactly ONE driver of suspend/resume.** Every suspend/resume/close from
   UI, overlay, CLI (`launcherctl`), or tests funnels through the single FIFO
   queue in `main/suspender.js` (one op in flight, globally). Never call the
   suspend/resume scripts from a second automation while the launcher runs —
   two drivers race over the state files. Manual `gamectl suspend/resume` is
   tolerated only because the reconciler picks it up within one tick (~2s).
   Sunshine prep-cmds must stay UNWIRED from pause (`gamectl verify` asserts
   this on the host).
2. **Operate on the WHOLE process tree, tracked by pid set via /proc — never
   by re-grepping `AppId=`.** Steam's wrapper chain (sh → reaper →
   pressure-vessel → Wine/game) means: the window's `_NET_WM_PID` is a
   descendant, and once the wrapper dies the `AppId=` marker vanishes from
   every cmdline while the Wine tree lives on. Re-grepping mid-close reads
   that as "game exited" (this stranded ANNO once — window gone, music still
   playing). Capture the tree once (`procs.appIdTrees()`), then track those
   pids via `/proc/<pid>/stat` (`procs.procStatesSync`).
3. **Kill/close order:** SIGCONT first (a SIGSTOPped process can't be reaped —
   without CONT a frozen game lingers), then signal **children first** so
   parents don't respawn them. `lifecycle._hardKill()` is the single shared
   implementation; don't fork it.
4. **Resume must re-focus the returning window.** A frozen game's window drops
   out of `_NET_CLIENT_LIST` entirely; after SIGCONT, poll (≤10s) for a window
   whose `_NET_WM_PID` is in the resumed pid set, then `xdotool windowactivate`.
   This focus bug is the reason the launcher exists (see history doc).
5. **State is re-derived, never trusted from memory.** All persistent truth
   lives in `/run/user/1000/sunshine-susp-*.pids` + the process table; the
   reconciler (`lifecycle.reconcile()`) rebuilds per-game state every tick.
   The launcher must survive its own crash/restart with parked games intact.

## 3. Controller input — the traps that already bit

- **NEVER use the web Gamepad API.** Chromium's gamepad layer goes blind the
  moment Steam Input attaches to the pad (happened for real: overlay opened,
  controller dead in it). ALL controller input is read raw from
  `/dev/input/event*` in the main process (`main/evdev.js`) and forwarded to
  the renderer as semantic actions over IPC (`pad:action`, `pad:dirs`,
  `pad:brand`). Keyboard remains a mirror in the renderer.
- **Gamepad detection = KEY-bitmask bit 316 (`BTN_MODE`)** parsed from
  `/proc/bus/input/devices`. "Has a jsN handler" is NOT a valid test — on this
  host Sunshine's absolute-mouse device gets `js0`.
- **Hotplug is the NORMAL case.** Sunshine creates its virtual pad only while
  a client streams with a controller attached; Steam Input may grab it and
  re-emit a "Steam Virtual Gamepad". Open EVERY BTN_MODE device, de-dupe
  presses across devices (50ms echo window; 400ms for Guide).
- Button mapping is per-brand and PHYSICAL-position-based (`main/padmap.js`,
  pure + unit-tested): kernel code 307/308 mean different physical buttons on
  xpad vs hid-playstation; Nintendo swaps confirm/cancel. Axis calibration:
  Sony pads report 0..255 centered 128, everything else signed 16-bit.
- **Steam's "Open Steam Home when Guide button is pressed" must be OFF** in
  Steam settings, or Steam fights the overlay for focus on every Guide press.
  This setting has NO config-file representation (it lives in Steam's opaque
  cloud-storage blob, field `controller_guide_button_focus_steam` #14002) —
  it can only be toggled in Steam's UI. Do not chase it in .vdf files.

## 4. Policy decisions (user-chosen — do not "improve" without asking)

- **Close = immediate hard kill.** No WM_DELETE / SIGTERM grace. The user
  explicitly chose speed over graceful shutdown; the UI confirm dialog is the
  only safety. (History: it was WM_DELETE → 15s → SIGTERM → 10s → prompt; the
  user hated the wait.)
- **`singleGameMode` (config, DEFAULT ON):** only one game may exist at a time.
  Starting a different game while one is open (running OR suspended) → UI
  confirm → hard-close the other(s) → launch. Rationale: SIGSTOP frees **no**
  VRAM (measured; the driver reclaims only under pressure and not reliably
  fast), and stacked games on the 8 GB card starve Sunshine's encoder →
  `vkAllocateMemory`/CUDA OOM → Moonlight reports "timeout" on connect. This
  actually happened (Lies of P held 5.5 GB parked). Enforced in
  `lifecycle.launch()` (belt) with the confirm in `renderer/start-game.js`
  (suspenders), so CLI launches are covered too. When OFF, the old Xbox-style
  `autoSuspendOnSwitch` applies.
- Games launch via `setsid steam steam://rungameid/<appid>` — never
  `steam://exitsteam` anywhere (kills the whole Steam client).

## 5. Electron / environment traps

- `bin/launcher.sh` passes **`--no-sandbox`** (Ubuntu 25.10 restricts
  unprivileged user namespaces and the SUID helper under node_modules isn't
  root-owned; local-only kiosk → acceptable) and **`--password-store=basic`**
  (else gnome-keyring pops an unlock prompt — one such prompt was once frozen
  by a no-arg suspend and appeared as a mystery black box on screen).
- It also sets `DISPLAY=:0`, `XAUTHORITY=/run/user/1000/gdm/Xauthority`
  (GDM-managed even though the session is XFCE) and forces
  `PULSE_SERVER=unix:/run/user/1000/pulse/native` — the host's `~/.zshrc`
  exports a PulseAudio tunnel to a Mac that must not leak in (host trap).
- All child processes are spawned via `execFile`/`spawn` with explicit env
  (`main/util.js` XENV) — never through a shell (the host's interactive shell
  is zsh, which does not word-split unquoted vars).
- Renderer is `contextIsolation: true, sandbox: true`; ALL privileged access
  goes through `preload/preload.js`. Keep it that way.
- Window management: `fullscreen: true, frame: false` (deliberately NOT
  `kiosk:` — kiosk fights focus handoff to games). Display resolution changes
  per Moonlight client (host's `set-client-res.sh` flips the mode); handled by
  re-asserting bounds on `display-metrics-changed`. Focus handoff always via
  `xdotool windowactivate` — `win.focus()` alone is not trusted against xfwm4.
- Overlay = the SAME window shown always-on-top; it re-asserts focus ~450ms
  after opening because Steam may react to the same Guide press.
- `main/window.js` logs renderer console errors + `render-process-gone` into
  the launcher log — keep this; renderer failures are otherwise silent black.

## 6. Debugging on the headless host — read before chasing ghosts

- **`ffmpeg -f x11grab` screenshots read BLACK when no Moonlight client is
  actively streaming** (NvFBC-managed framebuffer isn't scanned out). A black
  grab is NOT evidence the UI is broken — the bare desktop grabs black too.
  The reliable capture path is the control socket's `screenshot` command
  (`webContents.capturePage`, bypasses X entirely):
  `echo '{"cmd":"screenshot","path":"/tmp/x.png"}' | nc -U /run/user/1000/launcher.sock`
- **Never `pkill -f electron`** in a compound command — the pattern matches
  the shell running the command itself (its cmdline contains "electron") and
  kills your own command mid-flight. Match on `password-store=basic` instead.
- A **suspended game's fullscreen window is a frozen black rectangle** that
  can cover the screen; it cannot repaint until SIGCONT. Don't misread it as
  a launcher/display failure.
- Steam UI black-screen (loading tile only) → clear
  `~/.local/share/Steam/config/htmlcache` with Steam stopped, then restart it.
- Logs: `/run/user/1000/launcher.log` (app, also live-tailed in Debug screen),
  `/run/user/1000/launcher-stdout.log` (Electron stderr). Both tmpfs — gone on
  reboot.

## 7. Commands

```bash
npm test                                   # 23 unit tests — no X/Steam/pad needed
./bin/launcher.sh                          # run (sets env itself; works from SSH)
./bin/launcherctl <cmd> [appid]            # ping|status|frozen|launch|play|suspend|
                                           # resume|close|force-kill|clear-stale|
                                           # resume-all|resync|show|hide|quit
./test/test-launcher-quick-resume.sh A B   # 30-assertion suite; needs 2 running
                                           # games + the launcher up; drives
                                           # launcherctl (same queue as the UI)
```

After ANY change to lifecycle/suspender/procs: run `npm test`, then the
30-assertion suite, and confirm the host's original `test-quick-resume.sh`
still passes (the scripts must remain untouched and equivalent).

## 8. File map (main process = source of truth)

| Path | Role |
|---|---|
| `main/lifecycle.js` | State machine + reconciler + `_hardKill` — the core. |
| `main/suspender.js` | THE single FIFO op queue → host suspend/resume scripts. |
| `main/derive.js` | Pure state derivation (unit-tested; mirrors host `gstate()` semantics). |
| `main/procs.js` | pgrep/pstree/proc snapshots; `procStatesSync` reads `/proc/*/stat`. |
| `main/evdev.js` | Raw controller reader (BTN_MODE discovery, hotplug, semantic events). |
| `main/padmap.js` | Pure button/axis mapping per brand (unit-tested). |
| `main/x11.js` | `_NET_CLIENT_LIST` / `_NET_WM_PID` queries, xdotool activate/close. |
| `main/sysmon.js` | CPU (/proc/stat delta), RAM (/proc/meminfo), GPU (nvidia-smi). |
| `main/window.js` | Kiosk window, overlay mode, resolution-change refit, renderer logging. |
| `main/control.js` | Unix socket `/run/user/1000/launcher.sock` (launcherctl + tests + screenshot). |
| `main/library.js` + `tools/steam-library.py` | Steam library via the host's `sync-steam-apps.py` (SKIP_NAME filter, PNG transcode — single-sourced there, never duplicated). |
| `renderer/start-game.js` | Shared play entry; singleGameMode confirm lives here. |
| `renderer/screens/` | library / overlay / debug views (dumb views over state snapshots). |
| `config.default.json` | Defaults; user overrides merge from `config.json` (gitignored). |

## 9. Hard-coded host coupling

`/home/nerio/moonlight` (scripts, covers) and `/run/user/1000` (state, socket,
logs) are hard-coded in `main/util.js` and the bin scripts. Steam library paths
come from the host's `libraryfolders.vdf`. Portability = introduce a config
block for these; until then, do not assume this runs anywhere but the host.
