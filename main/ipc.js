'use strict';
// Single registry of all IPC channels main ↔ renderer.
const { ipcMain } = require('electron');
const fs = require('fs');
const logger = require('./logger');
const { RUN, HOME } = require('./util');

const LOG_FILES = {
  launcher: logger.LOG_PATH,
  suspend: `${RUN}/sunshine-suspend.log`,
  sunshine: `${HOME}/.config/sunshine/sunshine.log`,
  res: `${RUN}/sunshine-res.log`,
};

function registerIpc({ lifecycle, library, window: win, config, evdev, sysmon, app }) {
  // ---- library ----
  ipcMain.handle('library:get', () => library.snapshot());
  ipcMain.handle('library:resync', () => library.refresh({ art: true }));
  library.on('updated', (snap) => win.send('library:updated', snap));

  // ---- game ops ----
  ipcMain.handle('game:play', (_e, { appid }) => lifecycle.play(appid));
  ipcMain.handle('game:launch', (_e, { appid }) => lifecycle.launch(appid));
  ipcMain.handle('game:suspend', (_e, { appid }) => lifecycle.suspend(appid));
  ipcMain.handle('game:resume', (_e, { appid }) => lifecycle.resume(appid || null));
  ipcMain.handle('game:close', (_e, { appid }) => lifecycle.close(appid));
  ipcMain.handle('game:forceKill', (_e, { appid }) => lifecycle.forceKill(appid));
  ipcMain.handle('game:clearStale', (_e, { appid }) => lifecycle.clearStale(appid));
  ipcMain.handle('game:focus', (_e, { appid }) => lifecycle.focus(appid));

  // ---- state ----
  lifecycle.on('state', (snap) => win.send('state:updated', snap));
  ipcMain.handle('state:get', () => lifecycle.snapshot());

  // ---- overlay navigation ----
  ipcMain.handle('nav:returnToGame', async () => {
    const appid = await lifecycle.focusedGame();
    if (appid) {
      const r = await lifecycle.focus(appid);
      if (r.ok) { win.hide(); return { ok: true }; }
    }
    win.hide();
    return { ok: true, warning: 'no game window to return to' };
  });
  ipcMain.handle('nav:showLibrary', () => { win.showLibrary(); return { ok: true }; });
  ipcMain.handle('nav:hide', () => { win.hide(); return { ok: true }; });

  // ---- config ----
  ipcMain.handle('config:get', () => config.get());
  ipcMain.handle('config:set', (_e, patch) => config.set(patch));

  // ---- system resource stats ----
  ipcMain.handle('sys:stats', () => sysmon.latest());

  // ---- debug: log tails ----
  const tails = new Map(); // name -> fs.watch
  ipcMain.handle('debug:logTail', (_e, { name, lines = 60 }) => {
    const file = LOG_FILES[name];
    if (!file) return { ok: false, error: 'unknown log' };
    try {
      const content = fs.readFileSync(file, 'utf8').split('\n');
      return { ok: true, lines: content.slice(-lines) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('debug:subscribeLogs', () => {
    for (const [name, file] of Object.entries(LOG_FILES)) {
      if (tails.has(name)) continue;
      try {
        let size = fs.statSync(file).size;
        const w = fs.watch(file, () => {
          try {
            const st = fs.statSync(file);
            if (st.size <= size) { size = st.size; return; }
            const fd = fs.openSync(file, 'r');
            const buf = Buffer.alloc(st.size - size);
            fs.readSync(fd, buf, 0, buf.length, size);
            fs.closeSync(fd);
            size = st.size;
            win.send('debug:logData', { name, lines: buf.toString().split('\n').filter(Boolean) });
          } catch { /* rotated */ }
        });
        tails.set(name, w);
      } catch { /* file may not exist yet */ }
    }
    return { ok: true };
  });
  ipcMain.handle('debug:unsubscribeLogs', () => {
    for (const w of tails.values()) w.close();
    tails.clear();
    return { ok: true };
  });

  // ---- debug: input tap + device list ----
  let evdevTap = null;
  ipcMain.handle('debug:subscribeInput', () => {
    if (!evdevTap) {
      evdevTap = (evt) => win.send('debug:inputEvent', evt);
      evdev.on('event', evdevTap);
    }
    return { ok: true, devices: evdev.devices };
  });
  ipcMain.handle('debug:unsubscribeInput', () => {
    if (evdevTap) { evdev.off('event', evdevTap); evdevTap = null; }
    return { ok: true };
  });
  evdev.on('devices', (devices) => win.send('debug:devices', devices));

  // ---- debug: state files ----
  ipcMain.handle('debug:stateFiles', () => {
    const files = {};
    try {
      for (const name of fs.readdirSync(RUN)) {
        if (/^sunshine-susp-/.test(name) || name === 'launcher.log') {
          if (name === 'launcher.log') continue;
          try { files[name] = fs.readFileSync(`${RUN}/${name}`, 'utf8').trim(); }
          catch { files[name] = '(unreadable)'; }
        }
      }
    } catch { /* run dir gone?! */ }
    return files;
  });

  // ---- debug: actions ----
  ipcMain.handle('debug:action', async (_e, { action, appid }) => {
    switch (action) {
      case 'resumeAll': return lifecycle.resumeAll();
      case 'resyncLibrary': return library.refresh({ art: true });
      case 'clearStale': return lifecycle.clearStale(appid);
      case 'restartLauncher': app.relaunch(); app.quit(); return { ok: true };
      case 'quitLauncher': setTimeout(() => app.quit(), 150); return { ok: true };
      default: return { ok: false, error: 'unknown action' };
    }
  });

  ipcMain.handle('system:info', () => {
    const { screen } = require('electron');
    const d = screen.getPrimaryDisplay();
    return {
      display: { width: d.bounds.width, height: d.bounds.height, rate: d.displayFrequency },
      versions: { electron: process.versions.electron, node: process.versions.node },
      socket: `${RUN}/launcher.sock`,
      pid: process.pid,
    };
  });
}

module.exports = { registerIpc, LOG_FILES };
