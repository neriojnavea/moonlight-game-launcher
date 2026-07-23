# Moonlight Game Launcher

A fullscreen, controller-driven game launcher for a headless Linux
[Sunshine](https://github.com/LizardByte/Sunshine) game-streaming host — a
console-style front end that replaces Steam Big Picture and adds **Xbox-style
quick resume** (suspend a game, play another, come back exactly where you left
off) with an explicit UI, an in-game overlay, and a live resource monitor.

Built for streaming a headless RTX desktop to Moonlight clients (iPhone,
MacBook) over Tailscale, but the design is general to any XFCE/Xorg + NVIDIA +
Steam host.

> **Heads up:** this is a personal project tailored to one specific host
> (`~/moonlight` on an Ubuntu 25.10 / XFCE / Xorg / RTX 3070 machine). Paths are
> currently hard-coded (`/home/nerio/moonlight`, `/run/user/1000`). It's shared
> as a reference and a starting point, not a turnkey install. See
> [Coupling & portability](#coupling--portability).

## Features

- **Library rail** — installed Steam games with portrait box art, ambient
  art background, glow/scale focus animations, and live status badges
  (Running / Suspended / Stale).
- **Quick resume, made explicit** — launch or resume a game with one button.
  On resume it waits for the game's window to reappear and refocuses it (frozen
  windows drop out of `_NET_CLIENT_LIST`), so controller input lands in the game
  and not the launcher.
- **Single-game mode** (default) — only one game runs at a time; starting a new
  one hard-closes the current one after a confirm. Prevents several games from
  stacking VRAM and starving the stream encoder. Toggle off for Xbox-style
  auto-suspend-on-switch instead.
- **In-game overlay** on the controller Guide/Home button — Return to game /
  Suspend & go to Library / Switch to another game / Close game.
- **Live resource monitor** — CPU, RAM, GPU, VRAM, temperature in the library
  and the overlay.
- **Debug screen** (controller-navigable) — live state table, log tails, an
  input-device viewer that doubles as a controller tester, and rescue actions
  (resume-all, resync library, restart / quit launcher).
- **Controller support** for Xbox / PlayStation / Nintendo pads with the correct
  button glyphs, read straight from `/dev/input` (evdev) so it keeps working even
  when Steam Input grabs the pad and the browser Gamepad API goes blind.

## Architecture

One [Electron](https://www.electronjs.org/) app, one fullscreen frameless
window, three renderer screens (Library / Overlay / Debug). Plain ES modules and
CSS — no framework, no bundler.

- **The main process owns all truth.** A reconciler re-derives per-game state
  every couple of seconds from the process table + suspend state files, so the
  UI survives launcher crashes/restarts and picks up external changes.
- **One driver for suspend/resume.** Every suspend/resume/close — from the UI,
  the overlay, the CLI, or the tests — funnels through a single FIFO queue
  (`main/suspender.js`) that shells out to the host's proven
  `suspend-game.sh` / `resume-game.sh` scripts, unchanged. This "exactly one
  driver" rule is what keeps parked processes from being stranded.
- **A Unix control socket** (`main/control.js`) + a `launcherctl` CLI drive the
  exact same code path as the UI, which is how the integration test suite runs.

```
main/       lifecycle.js  reconciler + game state machine (launch/suspend/resume/close)
            suspender.js  the single FIFO op queue → suspend/resume scripts
            evdev.js      raw /dev/input gamepad + Guide-button reader
            padmap.js     controller button/axis mapping (pure, tested)
            procs.js      process-table + suspend-state snapshots
            x11.js        window queries + focus handoff (xprop/xdotool)
            sysmon.js     CPU/RAM/GPU/VRAM sampler
            window.js control.js ipc.js config.js library.js logger.js
renderer/   app.js + screens/ (library, overlay, debug) + components/ + input/
tools/      steam-library.py   Steam library + box-art bridge (reuses host script)
bin/        launcher.sh  launcherctl
test/       unit/*.test.js (node --test)  +  test-launcher-quick-resume.sh
```

## Requirements

- Linux with **Xorg** (X11) — uses `xprop` / `xdotool` and `/dev/input`.
- **NVIDIA** GPU for the VRAM/GPU stats (`nvidia-smi`); degrades gracefully.
- **Node 20+**, and Electron (installed via `npm install`).
- **Steam** installed; games launched via `steam://rungameid/<appid>`.
- The companion host scripts this launcher drives (from the parent project):
  `suspend-game.sh`, `resume-game.sh`, `gamectl`, `sync-steam-apps.py`.
- User in the `input` group (for raw controller reads).

## Quick start

```bash
cd launcher
npm install            # downloads Electron
npm test               # unit tests (no X/Steam/controller needed)
./bin/launcher.sh      # start it (needs an X session)
```

Then disable Steam's guide-button binding so it doesn't fight the overlay:
**Steam → Settings → Controller → "Open Steam Home when the Guide button is
pressed" → OFF**.

Full operations manual and host wiring: [`install/SETUP.md`](install/SETUP.md).

## CLI

```
bin/launcherctl ping|status|frozen|resume-all|resync|show|hide|quit
bin/launcherctl launch|play|suspend|resume|close|force-kill <appid>
```

## Testing

```bash
npm test                                              # 23 unit tests
./test/test-launcher-quick-resume.sh <appidA> <appidB> # 30-assertion suite
```

The integration suite drives suspend/resume through `launcherctl` (the same code
path as the UI) and asserts per-game parking, quick resume, idempotent
double-suspend, no-arg last-resume, and resume-all rescue — 30/30, matching the
original host script suite.

## Coupling & portability

This launcher is currently coupled to one host:

- Absolute paths `/home/nerio/moonlight` (companion scripts, box art) and
  `/run/user/1000` (state files, control socket) are hard-coded in `main/util.js`
  and the shell scripts.
- It shells out to `suspend-game.sh` / `resume-game.sh` / `gamectl` /
  `sync-steam-apps.py` from the parent Moonlight/Sunshine project, which are not
  included here.

To run it elsewhere you'd generalise those paths (a config block) and supply
equivalent suspend/resume scripts. PRs welcome.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — the operational contract: invariants, traps, and
  policy decisions, each learned from a real failure. **Read this before
  changing the lifecycle, suspend, or input code** (also loaded automatically
  by AI coding agents like Claude Code).
- [`install/SETUP.md`](install/SETUP.md) — operations manual: setup steps,
  daily driving, controls, recovery.
- [`docs/HOST.md`](docs/HOST.md) — the headless Sunshine host this was built
  for and how its constraints (Xorg, NvFBC, 8 GB VRAM, resolution switching)
  shaped the design.
- [`docs/QUICK-RESUME-HISTORY.md`](docs/QUICK-RESUME-HISTORY.md) — the origin
  story: the first, Sunshine-wired quick-resume implementation, why its UX
  failed, and the requirements that produced this launcher.

## License

MIT — see [LICENSE](LICENSE).
