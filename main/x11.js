'use strict';
// X11 window queries and focus handoff via xprop/xdotool (wmctrl not installed).
const { run } = require('./util');
const { log } = require('./logger');

// Window ids currently in _NET_CLIENT_LIST. A frozen game's window DROPS OUT
// of this list (QUICK-RESUME §2.1) — that is why resume must poll for its return.
async function clientList() {
  const { stdout } = await run('xprop', ['-root', '_NET_CLIENT_LIST']);
  const m = stdout.match(/# (.*)$/m);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

async function windowPid(wid) {
  const { stdout } = await run('xprop', ['-id', wid, '_NET_WM_PID']);
  const m = stdout.match(/=\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

async function windowName(wid) {
  const { stdout } = await run('xprop', ['-id', wid, '_NET_WM_NAME']);
  const m = stdout.match(/=\s*"(.*)"/);
  return m ? m[1] : '';
}

// All windows whose _NET_WM_PID is inside pidSet. Proton games often own the
// window from a descendant pid, so callers must pass the WHOLE tree pid set.
async function windowsForPids(pidSet) {
  const wids = await clientList();
  const found = [];
  for (const wid of wids) {
    const pid = await windowPid(wid);
    if (pid !== null && pidSet.has(pid)) found.push({ wid, pid });
  }
  return found;
}

async function activate(wid) {
  const r = await run('xdotool', ['windowactivate', String(wid)]);
  if (r.code !== 0) log('x11', `windowactivate ${wid} failed:`, r.stderr.trim());
  return r.code === 0;
}

// WM_DELETE_WINDOW — graceful close request.
async function closeWindow(wid) {
  const r = await run('xdotool', ['windowclose', String(wid)]);
  return r.code === 0;
}

async function activeWindowPid() {
  const { stdout, code } = await run('xdotool', ['getactivewindow', 'getwindowpid']);
  if (code !== 0) return null;
  const pid = Number(stdout.trim());
  return Number.isInteger(pid) ? pid : null;
}

module.exports = { clientList, windowPid, windowName, windowsForPids, activate, closeWindow, activeWindowPid };
