'use strict';
// Pure per-game state derivation — no I/O, unit-testable.
// Semantics mirror gstate()/parked() in ~/moonlight/test-quick-resume.sh and
// `gamectl frozen` STALE detection.

const STATES = {
  NOT_RUNNING: 'NOT_RUNNING',
  LAUNCHING: 'LAUNCHING',
  RUNNING: 'RUNNING',
  SUSPENDING: 'SUSPENDING',
  SUSPENDED: 'SUSPENDED',
  RESUMING: 'RESUMING',
  CLOSING: 'CLOSING',
  STALE: 'STALE',
  FROZEN_EXTERN: 'FROZEN_EXTERN',
};

// procStates: Map pid -> ps state letter ('S','R','T','Z',...)
function treeCondition(pids, procStates) {
  let alive = 0, frozen = 0;
  for (const pid of pids) {
    const st = procStates.get(pid);
    if (st === undefined || st === 'Z') continue;
    alive++;
    if (st.startsWith('T')) frozen++;
  }
  if (alive === 0) return 'GONE';
  if (frozen === alive) return 'FROZEN';
  if (frozen > 0) return 'MIXED';
  return 'RUNNING';
}

/**
 * @param {object} snap
 *   snap.trees        Map appid -> Set(pid)     (live AppId= process trees)
 *   snap.procStates   Map pid -> state letter
 *   snap.pidFiles     Map key -> number[]       (sunshine-susp-<key>.pids contents; key = appid|'focused')
 * @returns Map appid|key -> { state, alive, condition, warning? }
 */
function deriveStates(snap) {
  const out = new Map();
  const keys = new Set([...snap.trees.keys(), ...snap.pidFiles.keys()]);
  for (const key of keys) {
    const treePids = snap.trees.get(key);
    const filePids = snap.pidFiles.get(key);
    if (treePids && treePids.size) {
      const cond = treeCondition(treePids, snap.procStates);
      let alive = 0;
      for (const pid of treePids) {
        const st = snap.procStates.get(pid);
        if (st !== undefined && st !== 'Z') alive++;
      }
      if (cond === 'GONE') {
        out.set(key, filePids
          ? { state: STATES.STALE, alive: 0, condition: cond }
          : { state: STATES.NOT_RUNNING, alive: 0, condition: cond });
      } else if (filePids) {
        if (cond === 'FROZEN') out.set(key, { state: STATES.SUSPENDED, alive, condition: cond });
        else if (cond === 'MIXED') out.set(key, { state: STATES.SUSPENDED, alive, condition: cond, warning: 'partially frozen (MIXED) — consider resume-all' });
        else out.set(key, { state: STATES.RUNNING, alive, condition: cond, warning: 'running but a parked-state file exists' });
      } else {
        if (cond === 'FROZEN') out.set(key, { state: STATES.FROZEN_EXTERN, alive, condition: cond, warning: 'frozen outside the launcher (no state file)' });
        else if (cond === 'MIXED') out.set(key, { state: STATES.RUNNING, alive, condition: cond, warning: 'some processes frozen (MIXED)' });
        else out.set(key, { state: STATES.RUNNING, alive, condition: cond });
      }
    } else if (filePids) {
      // pids file but no live AppId tree: STALE if every pid is dead,
      // SUSPENDED if the pids are alive but no longer match an AppId= cmdline
      // (some games exec away from the wrapper).
      let alive = 0, frozen = 0;
      for (const pid of filePids) {
        const st = snap.procStates.get(pid);
        if (st === undefined || st === 'Z') continue;
        alive++;
        if (st.startsWith('T')) frozen++;
      }
      if (alive === 0) out.set(key, { state: STATES.STALE, alive: 0, condition: 'GONE' });
      else if (frozen === alive) out.set(key, { state: STATES.SUSPENDED, alive, condition: 'FROZEN' });
      else out.set(key, { state: STATES.SUSPENDED, alive, condition: 'MIXED', warning: 'partially frozen (MIXED) — consider resume-all' });
    }
  }
  return out;
}

module.exports = { STATES, deriveStates, treeCondition };
