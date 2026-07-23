# The host this launcher runs on

Context for understanding the design decisions in this repo. The launcher is
one component of a larger headless game-streaming setup; the parent project
(not published) lives in `~/moonlight` on the host and carries the scripts this
launcher drives.

## The machine

| Fact | Value |
|---|---|
| Hardware | Ubuntu 25.10, RTX 3070 (Ampere, 8 GB VRAM), NVIDIA driver 580 |
| Desktop | **XFCE on Xorg** — not GNOME (GNOME 49 removed the X11 session), not Wayland |
| Display | **Headless virtual display** `DP-0` via xorg.conf `ConnectedMonitor` + synthetic EDID, native 2784x1284@120 |
| Streaming | [Sunshine](https://github.com/LizardByte/Sunshine) nightly, NvFBC capture + `hevc_nvenc`, YUV 4:4:4 8-bit SDR |
| Clients | iPhone 13 Pro Max (2784x1284@120) and MacBook Air 15" (2880x1864@60) via [Moonlight](https://moonlight-stream.org/) over Tailscale |
| Session | GDM autologin → XFCE; Sunshine autostarts via XDG autostart (not systemd) |

Why it matters here:

- **X11-only techniques are fine** (`xprop`, `xdotool`, `_NET_CLIENT_LIST`)
  because NvFBC capture requires Xorg anyway. None of this works on Wayland.
- **The display resolution changes at runtime** — a Sunshine prep command
  switches `DP-0` to each connecting client's resolution (with exact-integer
  refresh rates to fix frame pacing). The launcher window must refit itself.
- **XFCE's compositor is off** — no window transparency exists, which is why
  the in-game overlay is designed opaque (dimmed box art) from day one.
- **8 GB of VRAM is the real budget.** Suspended (SIGSTOP) games keep all
  their VRAM; the NVIDIA driver reclaims only under memory pressure, not
  reliably or promptly. If total VRAM nears the limit, Sunshine's encoder
  fails to allocate (`vkAllocateMemory: -2`, CUDA OOM) and Moonlight reports a
  connection *timeout* — which looks like a network problem but isn't. This is
  the reason `singleGameMode` exists and defaults to on.

## The suspend/resume machinery (parent project)

The launcher shells out to these host scripts, which were built and
battle-tested before the launcher existed (see
[QUICK-RESUME-HISTORY.md](./QUICK-RESUME-HISTORY.md)):

```
suspend-game.sh [appid]   SIGSTOP a game's whole pstree + the Steam client tree
resume-game.sh  [appid]   SIGCONT Steam + that game (no arg: last parked)
gamectl                   status / frozen / resume-all / verify
sync-steam-apps.py        Steam library enumeration + box-art pipeline
test-quick-resume.sh A B  30-assertion integration suite over the scripts
```

State layout (tmpfs, cleared on reboot):

```
/run/user/1000/sunshine-susp-steam.pids    Steam client pids (shared; always resumed)
/run/user/1000/sunshine-susp-<appid>.pids  one file per parked game
/run/user/1000/sunshine-susp-last          most recently parked game
```

Hard-won script invariants (do not re-learn these the hard way):

1. Suspending a game must subtract **ALL** games' pids from Steam's tree, not
   just the current one — Steam's pstree contains every running game.
2. Never use `comm` to subtract pid lists — it requires lexically sorted input
   and these are numerically sorted, so it silently subtracts nothing. Use
   `grep -vxF -f`.
3. Steam is always suspended/resumed together with the game (deliberate).
4. SIGSTOP is **single-player only** — online games get kicked by server
   timeouts / anti-cheat.

## Host quirks that shaped this code

- `~/.zshrc` exports `PULSE_SERVER` pointing at a tunnel to a Mac — any process
  launched from an interactive shell inherits it and captures the wrong
  machine's audio. `bin/launcher.sh` pins local PulseAudio explicitly.
- SSH sessions have no `DISPLAY`; everything sets
  `DISPLAY=:0 XAUTHORITY=/run/user/1000/gdm/Xauthority` explicitly.
- A known Proton bug (not ours): Proton Experimental fails to re-bind a
  hotplugged gamepad; games ignore the pad while Steam's UI sees it. Fix is
  forcing a stable Proton per game — do not chase it in launcher/Sunshine code.
- Screenshots of the headless display via `x11grab` read black unless a client
  is actively streaming; use the launcher's `screenshot` socket command
  (capturePage) instead.
