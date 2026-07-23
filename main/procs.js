'use strict';
// Process-table snapshots for the reconciler and lifecycle.
const fs = require('fs');
const path = require('path');
const { RUN, run } = require('./util');

// appid -> Set(root pids) from live `AppId=<id>` command lines.
async function appIdRoots() {
  const { stdout } = await run('pgrep', ['-af', 'AppId=[0-9]+']);
  const roots = new Map();
  for (const line of stdout.split('\n')) {
    const m = line.match(/^(\d+)\s.*AppId=(\d+)/);
    if (!m) continue;
    const [, pid, appid] = m;
    if (!roots.has(appid)) roots.set(appid, new Set());
    roots.get(appid).add(Number(pid));
  }
  return roots;
}

// Full descendant pid set of one root, same technique as suspend-game.sh tree_of().
async function treeOf(pid) {
  const { stdout } = await run('pstree', ['-p', String(pid)]);
  const pids = new Set();
  for (const m of stdout.matchAll(/\((\d+)\)/g)) pids.add(Number(m[1]));
  return pids;
}

// appid -> Set(all pids in all its trees)
async function appIdTrees() {
  const roots = await appIdRoots();
  const trees = new Map();
  for (const [appid, rootSet] of roots) {
    const all = new Set();
    for (const root of rootSet) {
      for (const pid of await treeOf(root)) all.add(pid);
    }
    trees.set(appid, all);
  }
  return { roots, trees };
}

// Map pid -> state letter, read straight from /proc/<pid>/stat — no
// subprocess, so it can't misreport "gone" on a transient exec failure.
// Missing pids are simply absent from the map (= dead).
function procStatesSync(pids) {
  const states = new Map();
  for (const pid of pids) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const i = stat.lastIndexOf(')'); // comm can contain ')' — take the last
      const st = stat.slice(i + 2, i + 3);
      if (st) states.set(Number(pid), st);
    } catch { /* dead */ }
  }
  return states;
}

// Async-compatible wrapper kept for existing callers.
async function procStates(pids) {
  return procStatesSync(pids);
}

// sunshine-susp-<key>.pids files (excluding steam) -> Map key -> number[]
function readPidFiles() {
  const files = new Map();
  let names = [];
  try { names = fs.readdirSync(RUN); } catch { return files; }
  for (const name of names) {
    const m = name.match(/^sunshine-susp-(.+)\.pids$/);
    if (!m || m[1] === 'steam') continue;
    try {
      const pids = fs.readFileSync(path.join(RUN, name), 'utf8')
        .split('\n').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
      files.set(m[1], pids);
    } catch { /* raced with resume script removing it */ }
  }
  return files;
}

function readSteamPidFile() {
  try {
    return fs.readFileSync(`${RUN}/sunshine-susp-steam.pids`, 'utf8')
      .split('\n').map((s) => Number(s.trim())).filter((n) => n > 0);
  } catch { return null; }
}

function readLastParked() {
  try { return fs.readFileSync(`${RUN}/sunshine-susp-last`, 'utf8').trim() || null; }
  catch { return null; }
}

async function steamRunning() {
  const { code } = await run('pgrep', ['-x', 'steam']);
  return code === 0;
}

module.exports = {
  appIdRoots, appIdTrees, treeOf, procStates, procStatesSync,
  readPidFiles, readSteamPidFile, readLastParked, steamRunning,
};
