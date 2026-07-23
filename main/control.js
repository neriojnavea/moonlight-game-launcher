'use strict';
// Unix control socket: newline-delimited JSON {cmd, appid?} → {ok, ...}.
// Lets launcherctl and the ported quick-resume test suite drive the SAME code
// path as the UI (single-driver invariant covers them too).
const net = require('net');
const fs = require('fs');
const { RUN } = require('./util');
const { log } = require('./logger');

const SOCK = `${RUN}/launcher.sock`;

function startControl({ lifecycle, library, window: win, app }) {
  try { fs.rmSync(SOCK, { force: true }); } catch { /* ok */ }

  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', async (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let req;
        try { req = JSON.parse(line); }
        catch { conn.write(JSON.stringify({ ok: false, error: 'bad json' }) + '\n'); continue; }
        const res = await handle(req).catch((e) => ({ ok: false, error: e.message }));
        try { conn.write(JSON.stringify(res) + '\n'); } catch { /* client gone */ }
      }
    });
    conn.on('error', () => {});
  });

  async function handle(req) {
    const { cmd, appid } = req;
    switch (cmd) {
      case 'ping': return { ok: true, pong: true, pid: process.pid };
      case 'status': {
        await lifecycle.reconcile();
        return { ok: true, ...lifecycle.snapshot() };
      }
      case 'frozen': {
        await lifecycle.reconcile();
        const snap = lifecycle.snapshot();
        const frozen = {};
        for (const [k, v] of Object.entries(snap.games)) {
          if (['SUSPENDED', 'STALE', 'FROZEN_EXTERN'].includes(v.state)) frozen[k] = v;
        }
        return { ok: true, frozen, steam: snap.steam, lastParked: snap.lastParked };
      }
      case 'launch': return requireApp(appid, () => lifecycle.launch(appid));
      case 'play': return requireApp(appid, () => lifecycle.play(appid));
      case 'suspend': return requireApp(appid, () => lifecycle.suspend(appid));
      case 'resume': return lifecycle.resume(appid || null);
      case 'close': return requireApp(appid, () => lifecycle.close(appid));
      case 'force-kill': return requireApp(appid, () => lifecycle.forceKill(appid));
      case 'clear-stale': return requireApp(appid, () => lifecycle.clearStale(appid));
      case 'resume-all': return lifecycle.resumeAll();
      case 'resync': return { ok: true, ...(await library.refresh({ art: true })) };
      case 'screenshot': {
        // Capture straight from the renderer (bypasses X/NvFBC, which reads
        // black when no Moonlight client is streaming).
        const img = await win.win.webContents.capturePage();
        const p = (req.path || '/tmp/launcher-shot.png');
        require('fs').writeFileSync(p, img.toPNG());
        return { ok: true, path: p };
      }
      case 'show': win.showLibrary(); return { ok: true };
      case 'hide': win.hide(); return { ok: true };
      case 'quit': setTimeout(() => app.quit(), 100); return { ok: true };
      default: return { ok: false, error: `unknown cmd: ${cmd}` };
    }
  }

  function requireApp(appid, fn) {
    if (!appid) return { ok: false, error: 'appid required' };
    return fn();
  }

  server.listen(SOCK, () => log('control', `listening on ${SOCK}`));
  server.on('error', (e) => log('control', 'socket error:', e.message));
  return server;
}

module.exports = { startControl, SOCK };
