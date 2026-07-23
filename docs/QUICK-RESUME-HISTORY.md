# Quick Resume — retrospective & resurrection guide

**Status: BUILT, TESTED (30/30), THEN UNHOOKED on 2026-07-22 by user decision.**
Nerio didn't like how it felt in practice and had a **custom launcher** built instead —
**that launcher now exists (`~/moonlight/launcher/`, same day) and owns stop/resume**,
satisfying every requirement in §5 below (explicit parking UI, window refocus after
resume, resume-before-close, single driver). This document records the first
Sunshine-wired version, why it was set aside, and how to bring it back if ever wanted.

---

## 1. What was built (2026-07-19)

Xbox-style per-game quick resume, driven by Sunshine's connect/disconnect events:

- **Disconnect from Moonlight** → the game you were in gets `SIGSTOP`ed (0% CPU/GPU),
  Steam alongside it. Each game parks **independently**.
- **Reconnect and launch game B** → only B (and Steam) resume; parked game A stays frozen
  exactly where it was.
- **Reconnect to Desktop** → resumes whatever you were last playing.
- Everything survives any ordering: double-suspends merge, double-resumes no-op.

### State design (all in `/run/user/1000`, tmpfs — cleared on reboot)
```
sunshine-susp-steam.pids    Steam-client PIDs only. Shared; always resumed on any connect.
sunshine-susp-<appid>.pids  One file per game — the mechanism of per-game parking.
sunshine-susp-last          Key parked most recently; no-arg resume revives this one.
```

### The pieces (ALL STILL ON DISK, fully working when driven manually)
| File | Role |
|---|---|
| `suspend-game.sh [appid]` | Freeze game (+Steam). Resolves focused window → appid if no arg. |
| `resume-game.sh [appid]` | Resume Steam + one game (arg), or the last-parked one (no arg). |
| `gamectl frozen` | List parked games, flag STALE entries whose process died. |
| `gamectl resume-all` | Rescue: unfreeze everything. |
| `test-quick-resume.sh <A> <B>` | 30-assertion suite. Needs two running Steam games. |

Manual driving still works today: `gamectl suspend 1627720`, `gamectl resume 1627720`.

---

## 2. Why it was unhooked — what Nerio didn't like

The mechanism worked (all tests green), but the **experience** had rough edges:

1. **Focus loss after resume (the trigger).** After resuming a game, its window was not
   re-focused — controller input went to Steam Big Picture instead of the game. Root cause
   (diagnosed, fix designed but NOT implemented): a frozen game stops answering X, so its
   window **drops out of `_NET_CLIENT_LIST`** entirely; after `SIGCONT` the window takes a
   moment to come back, and nothing re-focused it. A fix would need to poll for the window's
   return, then activate it (`xdotool` **is now installed** for exactly this).
2. **"I closed it" ≠ closed.** Quitting a game that was frozen only *queued* the quit; the
   game sat parked holding ~4.8 GB VRAM looking closed, and actually exited only when later
   resumed. Confusing, easy to strand memory without noticing.
3. **Invisible, implicit behavior.** Disconnect silently froze things; there was no UI on
   the client side showing what's parked. Nerio prefers **explicit control** — hence the
   launcher plan.

None of these are mechanism failures; they're UX consequences of hanging the feature off
connect/disconnect events with no user-facing surface.

---

## 3. Hard-won invariants (apply to ANY future implementation, incl. the launcher)

1. **Exactly ONE caller per suspend/resume event.** When pause was wired in both
   `global_prep_cmd` and per-app prep-cmds, the two handlers raced over the state files and
   stranded processes frozen. Sunshine wiring must be per-app only; a launcher must be the
   sole driver.
2. **Subtract ALL game PIDs from Steam's tree, not just the current game's.** Steam's
   `pstree` contains every running game as a descendant; partial subtraction meant
   suspending A froze B and resuming A woke B. (Caught by tests T1/T3.)
3. **Never use `comm` to subtract PID lists.** `comm` needs *lexically* sorted input; these
   lists are `sort -un` (numeric), so `comm` **silently subtracts nothing** — 148 pids in,
   148 out, no error. Use `grep -vxF -f`. This bug made invariant 2 fail while the code
   "looked" correct.

Also measured & settled (don't re-litigate):
- `SIGSTOP` frees **no** VRAM by itself (frozen game held 1089 MiB unchanged) — **but** the
  NVIDIA driver reclaims under pressure (Silksong 1089→438 MiB when Space Marine 2 loaded).
  Two games coexisted at 3.2/8 GB without issues.
- **Steam happily runs two games at once** (a queued launch even fires once Steam is
  resumed — that's how SM2 started "by itself" during testing).
- Freezing Steam mid-controller-unplug was once suspected of breaking gamepads; the real
  culprit was **Proton Experimental** (see CLAUDE.md §9). Not a reason to avoid SIGSTOP.

---

## 4. How to bring it back (Sunshine-wired version)

Everything needed still exists; only the *wiring* was removed.

1. **`sync-steam-apps.py`**: the `strip_pause()` function replaced the original
   `ensure_pause()`. Restore this function and call it instead of `strip_pause` in `main()`
   (`for a in preserved: ensure_pause(a)`), and re-add the prep-cmd block to `entry_for()`:

   ```python
   def ensure_pause(entry, appid=None):
       suffix = f" {appid}" if appid else ""   # None must NOT become literal "None"
       do = f"{MOON}/resume-game.sh{suffix}"
       undo = f"{MOON}/suspend-game.sh{suffix}"
       pc = [c for c in entry.get("prep-cmd", [])
             if "suspend-game.sh" not in c.get("undo", "")
             and "resume-game.sh" not in c.get("do", "")]
       pc.append({"do": do, "undo": undo, "elevated": "false"})
       entry["prep-cmd"] = pc
       return entry

   # in entry_for(), add back:
   #   "prep-cmd": [{"do": f"{MOON}/resume-game.sh {appid}",
   #                 "undo": f"{MOON}/suspend-game.sh {appid}",
   #                 "elevated": "false"}],
   ```

2. Run `./sync-steam-apps.py` (re-wires every entry; games get their appid, hand-made
   entries the no-arg form). **Keep pause OUT of `global_prep_cmd`** (invariant 1).
3. Flip `gamectl verify`'s expectation back (it currently asserts pause is *absent*).
4. Restart Sunshine (CLAUDE.md §3). Run `./test-quick-resume.sh <appidA> <appidB>` with two
   games running — expect 30/30.
5. To also fix the focus rough-edge: after `SIGCONT` in `resume-game.sh`, poll
   `_NET_CLIENT_LIST` (up to ~10s) for a window whose `_NET_WM_PID` is in the resumed PID
   set, then `xdotool windowactivate` it. (Designed, never implemented.)

---

## 5. Requirements the future launcher should satisfy (learned the hard way)

- Show **what's parked** (the `gamectl frozen` view) in the UI; make parking explicit.
- On resume: **wait for the game's window to reappear, then focus it** (see §2.1).
- On "close" of a parked game: **resume first, then quit** — a frozen process can't
  process a quit. (A `close <appid>` = CONT → graceful terminate → clear state file.)
- Always resume Steam with any game; keep the per-appid state layout (§1) — it's proven.
- Reuse `suspend-game.sh` / `resume-game.sh` as-is or absorb their logic with the three
  invariants from §3 intact, and keep `test-quick-resume.sh` running against whatever
  replaces them.
