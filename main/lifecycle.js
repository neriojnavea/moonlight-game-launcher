'use strict';
// Game lifecycle state machine + reconciler. Main-process source of truth.
//
// All mutating ops run through suspender.js's single FIFO queue (invariant:
// exactly ONE driver of suspend/resume). The reconciler re-derives reality
// from the process table + /run state files every tick, so external gamectl
// use, crashes and launcher restarts are all picked up within one tick.
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const procs = require('./procs');
const x11 = require('./x11');
const { STATES, deriveStates } = require('./derive');
const susp = require('./suspender');
const { XENV, sleep } = require('./util');
const { log } = require('./logger');
const fs = require('fs');
const { RUN } = require('./util');

class Lifecycle extends EventEmitter {
  constructor({ config, library }) {
    super();
    this.config = config;
    this.library = library;
    this.derived = new Map();   // key -> {state, alive, condition, warning, wid?, hasWindow?}
    this.leases = new Map();    // appid -> transient op state (LAUNCHING/SUSPENDING/...)
    this.orphans = new Map();   // appid -> Set(pids) surviving a failed close
    this.currentGame = null;    // appid the user is "in"
    this.steam = { running: false, frozen: false };
    this.lastParked = null;
    this.timer = null;
    this.tickMs = config.get().poll.visibleMs;
    this.reconciling = false;
  }

  // ---- reconciler -----------------------------------------------------------

  start() {
    const loop = async () => {
      try { await this.reconcile(); } catch (e) { log('lifecycle', 'reconcile error:', e.message); }
      this.timer = setTimeout(loop, this.tickMs);
    };
    loop();
  }

  stop() { clearTimeout(this.timer); }

  setVisible(visible) {
    const { poll } = this.config.get();
    this.tickMs = visible ? poll.visibleMs : poll.hiddenMs;
  }

  async reconcile() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const { trees } = await procs.appIdTrees();
      const pidFiles = procs.readPidFiles();
      const allPids = new Set();
      for (const set of trees.values()) for (const p of set) allPids.add(p);
      for (const list of pidFiles.values()) for (const p of list) allPids.add(p);
      const states = await procs.procStates(allPids);
      const derived = deriveStates({ trees, procStates: states, pidFiles });

      // Window presence for live games (one client-list pass).
      const wids = await x11.clientList();
      const widPids = new Map();
      for (const wid of wids) {
        const pid = await x11.windowPid(wid);
        if (pid !== null) widPids.set(wid, pid);
      }
      for (const [key, info] of derived) {
        const tree = trees.get(key);
        info.hasWindow = false;
        if (tree && (info.state === STATES.RUNNING || info.state === STATES.FROZEN_EXTERN)) {
          for (const [wid, pid] of widPids) {
            if (tree.has(pid)) { info.hasWindow = true; info.wid = wid; break; }
          }
        }
      }

      // Leases (ops in flight) override observed state for their appid.
      for (const [appid, leaseState] of this.leases) {
        const info = derived.get(appid) || { alive: 0, condition: 'GONE' };
        info.state = leaseState;
        derived.set(appid, info);
      }

      this.steam = {
        running: await procs.steamRunning(),
        frozen: procs.readSteamPidFile() !== null,
      };
      this.lastParked = procs.readLastParked();
      this.derived = derived;
      this.trees = trees;

      if (this.currentGame && !derived.has(this.currentGame)) this.currentGame = null;
      this.emit('state', this.snapshot());
    } finally {
      this.reconciling = false;
    }
  }

  snapshot() {
    const games = {};
    for (const [key, info] of this.derived) {
      games[key] = {
        state: info.state, alive: info.alive, condition: info.condition,
        warning: info.warning || null, hasWindow: !!info.hasWindow,
      };
    }
    return {
      games,
      steam: this.steam,
      lastParked: this.lastParked,
      currentGame: this.currentGame,
      opInFlight: susp.current(),
    };
  }

  stateOf(appid) {
    const info = this.derived.get(String(appid));
    return info ? info.state : STATES.NOT_RUNNING;
  }

  // The game the user is most plausibly "in": tracked current game if alive,
  // else the appid owning the focused X window.
  async focusedGame() {
    const cur = this.currentGame && this.derived.get(this.currentGame);
    if (cur && cur.state !== STATES.NOT_RUNNING && cur.state !== STATES.STALE) return this.currentGame;
    const pid = await x11.activeWindowPid();
    if (pid === null || !this.trees) return null;
    for (const [appid, tree] of this.trees) {
      if (tree.has(pid)) return appid;
    }
    return null;
  }

  // Appids other than `except` that are running or parked (anything the user
  // would consider "open"). Used by single-game mode and the UI's confirm.
  otherActiveGames(except) {
    except = except != null ? String(except) : null;
    const DEAD = new Set([STATES.NOT_RUNNING]);
    const out = [];
    for (const [key, info] of this.derived) {
      if (key === except) continue;
      if (!DEAD.has(info.state)) out.push(key);
    }
    return out;
  }

  _lease(appid, state) {
    this.leases.set(String(appid), state);
    const info = this.derived.get(String(appid)) || { alive: 0, condition: 'GONE' };
    info.state = state;
    this.derived.set(String(appid), info);
    this.emit('state', this.snapshot());
  }

  _unlease(appid) {
    this.leases.delete(String(appid));
  }

  // ---- ops (all queued) -----------------------------------------------------

  // UI entry point: do the right thing for the game's current state.
  async play(appid) {
    appid = String(appid);
    const st = this.stateOf(appid);
    if (st === STATES.RUNNING) return this.focus(appid);
    if (st === STATES.SUSPENDED || st === STATES.FROZEN_EXTERN) return this.resume(appid);
    if (st === STATES.STALE) { await this.clearStale(appid); return this.launch(appid); }
    return this.launch(appid);
  }

  async focus(appid) {
    appid = String(appid);
    const tree = this.trees && this.trees.get(appid);
    if (!tree) return { ok: false, error: 'not running' };
    const wins = await x11.windowsForPids(tree);
    if (!wins.length) return { ok: false, error: 'no window yet' };
    this.currentGame = appid;
    this.emit('hide-launcher');
    await x11.activate(wins[0].wid);
    return { ok: true };
  }

  launch(appid) {
    appid = String(appid);
    const cfg = this.config.get();
    return susp.enqueue(`launch ${appid}`, async () => {
      this._lease(appid, STATES.LAUNCHING);
      try {
        // singleGameMode wins over autoSuspendOnSwitch: only one game may exist
        // at a time, so hard-close every OTHER active game (running OR parked)
        // before launching. The UI already confirmed with the user.
        if (cfg.singleGameMode) {
          for (const key of this.otherActiveGames(appid)) {
            log('lifecycle', `single-game mode: hard-closing ${key} before launching ${appid}`);
            await this._hardKill(key);
          }
        } else if (cfg.autoSuspendOnSwitch) {
          // Xbox-style: launching B parks A.
          for (const [key, info] of this.derived) {
            if (key !== appid && info.state === STATES.RUNNING) {
              log('lifecycle', `auto-suspend ${key} before launching ${appid}`);
              await this._suspendVerified(key, cfg);
            }
          }
        }
        // Wake Steam if frozen. resume-game.sh <appid> with no pids file for
        // that appid resumes ONLY Steam; susp-last is untouched.
        if (procs.readSteamPidFile() !== null) await susp.resumeScript(appid);

        log('lifecycle', `steam rungameid ${appid}`);
        const child = spawn('setsid', ['steam', `steam://rungameid/${appid}`],
          { env: XENV, detached: true, stdio: 'ignore' });
        child.unref();

        // Phase 1: wait for the AppId= process tree.
        const procDeadline = Date.now() + cfg.timeouts.launchProcSec * 1000;
        let roots = null;
        while (Date.now() < procDeadline) {
          const map = await procs.appIdRoots();
          if (map.has(appid)) { roots = map.get(appid); break; }
          await sleep(500);
        }
        if (!roots) throw new Error(`game process did not appear within ${cfg.timeouts.launchProcSec}s`);

        // Phase 2: wait for a window owned by ANY pid in the tree (Proton
        // windows belong to descendants, and wrappers respawn — re-walk the
        // tree each poll).
        const winDeadline = Date.now() + cfg.timeouts.launchWindowSec * 1000;
        while (Date.now() < winDeadline) {
          const map = await procs.appIdRoots();
          if (!map.has(appid)) { await sleep(500); continue; }
          const tree = new Set();
          for (const r of map.get(appid)) for (const p of await procs.treeOf(r)) tree.add(p);
          const wins = await x11.windowsForPids(tree);
          if (wins.length) {
            this.currentGame = appid;
            this.emit('hide-launcher');
            await x11.activate(wins[0].wid);
            log('lifecycle', `launched ${appid}, window ${wins[0].wid} focused`);
            return { ok: true };
          }
          await sleep(500);
        }
        log('lifecycle', `launch ${appid}: process alive but no window after ${cfg.timeouts.launchWindowSec}s`);
        return { ok: true, warning: 'game is running but no window appeared yet' };
      } catch (e) {
        log('lifecycle', `launch ${appid} FAILED:`, e.message);
        return { ok: false, error: e.message };
      } finally {
        this._unlease(appid);
        this.reconcile().catch(() => {});
      }
    });
  }

  suspend(appid) {
    appid = String(appid);
    const cfg = this.config.get();
    return susp.enqueue(`suspend ${appid}`, async () => {
      this._lease(appid, STATES.SUSPENDING);
      try {
        await this._suspendVerified(appid, cfg);
        if (this.currentGame === appid) this.currentGame = null;
        return { ok: true };
      } catch (e) {
        log('lifecycle', `suspend ${appid} FAILED:`, e.message);
        return { ok: false, error: e.message };
      } finally {
        this._unlease(appid);
        this.reconcile().catch(() => {});
      }
    });
  }

  // Shared inner: run script then verify the tree is actually frozen.
  async _suspendVerified(appid, cfg) {
    await susp.suspendScript(appid);
    const deadline = Date.now() + cfg.timeouts.suspendVerifySec * 1000;
    while (Date.now() < deadline) {
      const { trees } = await procs.appIdTrees();
      const tree = trees.get(appid);
      if (!tree || !tree.size) throw new Error('game vanished during suspend');
      const states = await procs.procStates(tree);
      const allFrozen = [...tree].every((p) => {
        const st = states.get(p);
        return st === undefined || st === 'Z' || st.startsWith('T');
      });
      const fileExists = fs.existsSync(`${RUN}/sunshine-susp-${appid}.pids`);
      if (allFrozen && fileExists) return;
      await sleep(300);
    }
    throw new Error('suspend did not verify (tree not fully frozen or state file missing)');
  }

  // appid null → resume last parked (script decides), but we still need the
  // pid set for window-return polling, so read the state files up front.
  resume(appid) {
    appid = appid ? String(appid) : null;
    const cfg = this.config.get();
    const key = appid || procs.readLastParked();
    return susp.enqueue(`resume ${appid || '(last)'}`, async () => {
      if (key) this._lease(key, STATES.RESUMING);
      try {
        const pidFiles = procs.readPidFiles();
        const filePids = key ? (pidFiles.get(key) || []) : [];
        await susp.resumeScript(appid);

        if (!key) return { ok: true, focused: false };

        // The window of a frozen game drops out of _NET_CLIENT_LIST; poll for
        // its return, then focus it (the v1 UX bug this launcher exists to fix).
        const pidSet = new Set(filePids);
        // The tree may have re-registered under AppId= — include it too.
        const { trees } = await procs.appIdTrees();
        for (const p of trees.get(key) || []) pidSet.add(p);

        const deadline = Date.now() + cfg.timeouts.windowReturnSec * 1000;
        while (Date.now() < deadline) {
          const wins = await x11.windowsForPids(pidSet);
          if (wins.length) {
            this.currentGame = key;
            this.emit('hide-launcher');
            await x11.activate(wins[0].wid);
            log('lifecycle', `resumed ${key}, window ${wins[0].wid} focused`);
            return { ok: true, focused: true };
          }
          await sleep(400);
        }
        log('lifecycle', `resumed ${key} but window did not return within ${cfg.timeouts.windowReturnSec}s`);
        return { ok: true, focused: false, warning: 'game resumed but its window has not reappeared — try Focus again' };
      } catch (e) {
        log('lifecycle', `resume ${key} FAILED:`, e.message);
        return { ok: false, error: e.message };
      } finally {
        if (key) this._unlease(key);
        this.reconcile().catch(() => {});
      }
    });
  }

  // Immediate hard kill (user preference). Never steam://exitsteam.
  close(appid) {
    appid = String(appid);
    return susp.enqueue(`close ${appid}`, async () => {
      this._lease(appid, STATES.CLOSING);
      try {
        const res = await this._hardKill(appid);
        this.emit('show-launcher');
        return res;
      } catch (e) {
        log('lifecycle', `close ${appid} FAILED:`, e.message);
        return { ok: false, error: e.message };
      } finally {
        this._unlease(appid);
        this.reconcile().catch(() => {});
      }
    });
  }

  forceKill(appid) {
    appid = String(appid);
    return susp.enqueue(`forceKill ${appid}`, async () => {
      const res = await this._hardKill(appid);
      this.emit('show-launcher');
      this.reconcile().catch(() => {});
      return res;
    });
  }

  // SIGKILL the whole process tree of one game and clean up its state.
  // Capture the tree once and track those pids via /proc — never re-grep
  // AppId=, because once the reaper/sh wrapper dies the marker vanishes while
  // the Wine tree lives on (this stranded ANNO with its music still playing).
  // Include orphans remembered from an earlier failed kill.
  async _hardKill(appid) {
    appid = String(appid);
    const { trees } = await procs.appIdTrees();
    const tree = new Set([...(trees.get(appid) || []), ...(this.orphans.get(appid) || [])]);
    if (tree.size) {
      // CONT first: a SIGSTOPped process can't be reaped, so a frozen game
      // would linger if we only SIGKILLed it.
      for (const p of tree) { try { process.kill(p, 'SIGCONT'); } catch { /* gone */ } }
      // Children first so parents don't respawn them mid-kill.
      for (const p of [...tree].reverse()) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
      log('lifecycle', `hard-kill ${appid}: SIGKILL sent to ${tree.size} pids`);
      if (!(await this._waitTreeDead(tree, 5))) {
        this.orphans.set(appid, tree);
        log('lifecycle', `hard-kill ${appid}: some pids survived SIGKILL (?!)`);
        return { ok: false, error: 'some processes would not die' };
      }
    }
    this.orphans.delete(appid);
    this._cleanupStateFiles(appid);
    if (this.currentGame === appid) this.currentGame = null;
    log('lifecycle', `hard-killed ${appid}`);
    return { ok: true };
  }

  clearStale(key) {
    key = String(key);
    return susp.enqueue(`clearStale ${key}`, async () => {
      const pidFiles = procs.readPidFiles();
      for (const p of pidFiles.get(key) || []) {
        try { process.kill(p, 'SIGCONT'); } catch { /* dead, expected */ }
      }
      this._cleanupStateFiles(key);
      this.reconcile().catch(() => {});
      return { ok: true };
    });
  }

  resumeAll() {
    return susp.enqueue('resume-all', async () => {
      await susp.resumeAllScript();
      this.reconcile().catch(() => {});
      return { ok: true };
    });
  }

  async _waitGone(appid, seconds) {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      const map = await procs.appIdRoots();
      if (!map.has(appid)) return true;
      await sleep(500);
    }
    return false;
  }

  // Wait until every pid in the set is dead (or a zombie), checking /proc
  // directly — immune to pgrep races and wrapper-death blindness.
  async _waitTreeDead(pids, seconds) {
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      const states = procs.procStatesSync(pids);
      let alive = 0;
      for (const st of states.values()) if (st !== 'Z') alive++;
      if (alive === 0) return true;
      if (Date.now() >= deadline) return false;
      await sleep(250);
    }
  }

  _cleanupStateFiles(key) {
    try { fs.rmSync(`${RUN}/sunshine-susp-${key}.pids`, { force: true }); } catch { /* ok */ }
    try {
      if (procs.readLastParked() === key) fs.rmSync(`${RUN}/sunshine-susp-last`, { force: true });
    } catch { /* ok */ }
  }
}

module.exports = { Lifecycle, STATES };
