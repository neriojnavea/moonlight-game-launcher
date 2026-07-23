'use strict';
// Bootstrap: single-instance lock, module wiring, guide-button routing.
const { app } = require('electron');
const config = require('./config');
const { log } = require('./logger');
const { Library } = require('./library');
const { Lifecycle } = require('./lifecycle');
const { LauncherWindow } = require('./window');
const { EvdevReader } = require('./evdev');
const { SysMon } = require('./sysmon');
const { startControl, SOCK } = require('./control');
const { registerIpc } = require('./ipc');
const net = require('net');

// Second instance (e.g. the Sunshine "Game Launcher" entry) → tell the
// running one to show itself, then exit.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  const conn = net.createConnection(SOCK, () => {
    conn.write(JSON.stringify({ cmd: 'show' }) + '\n');
    conn.end();
    app.quit();
  });
  conn.on('error', () => app.quit());
} else {
  main();
}

function main() {
  config.load();
  const library = new Library();
  const lifecycle = new Lifecycle({ config, library });
  const win = new LauncherWindow();
  const evdev = new EvdevReader({ debounceMs: config.get().guideButton.debounceMs });
  const sysmon = new SysMon({ intervalMs: 2000 });

  app.on('second-instance', () => win.showLibrary());

  app.whenReady().then(async () => {
    log('main', `launcher starting, pid ${process.pid}, electron ${process.versions.electron}`);
    win.create();
    registerIpc({ lifecycle, library, window: win, config, evdev, sysmon, app });
    startControl({ lifecycle, library, window: win, app });

    // First reconcile before UI shows state: parked games from a previous
    // run appear with SUSPENDED/STALE badges immediately (crash-safe design).
    await lifecycle.reconcile().catch((e) => log('main', 'initial reconcile:', e.message));
    lifecycle.start();
    library.refresh({ art: true });
    library.watchSteamApps();
    evdev.start();
    sysmon.on('stats', (stats) => { if (win.isVisible()) win.send('sys:stats', stats); });
    sysmon.start();

    // Reconciler slows down while we're hidden; renderer also stops animating.
    win.win.on('show', () => lifecycle.setVisible(true));
    win.win.on('hide', () => lifecycle.setVisible(false));

    lifecycle.on('hide-launcher', () => win.hide());
    lifecycle.on('show-launcher', () => win.showLibrary());

    // ---- Guide/Home button routing ----
    let guideBusy = false;
    evdev.on('guide', async () => {
      const cfg = config.get();
      if (!cfg.guideButton.enabled || guideBusy) return;
      guideBusy = true;
      try {
        if (win.mode === 'overlay') {
          // Guide again in overlay → back to the game.
          const appid = await lifecycle.focusedGame();
          if (appid) {
            const r = await lifecycle.focus(appid);
            if (r.ok) { win.hide(); return; }
          }
          win.showLibrary();
        } else if (win.isVisible()) {
          // In the library with a game up → back to the game.
          const appid = await lifecycle.focusedGame();
          if (appid && lifecycle.stateOf(appid) === 'RUNNING') {
            const r = await lifecycle.focus(appid);
            if (r.ok) { win.hide(); return; }
          }
          // Nothing to return to: guide is a no-op in the library.
        } else {
          // Hidden → a game is (probably) in front.
          const appid = await lifecycle.focusedGame();
          if (appid && cfg.guideButton.action === 'suspend') {
            await lifecycle.suspend(appid);
            win.showLibrary();
          } else if (appid) {
            win.showOverlay(appid);
          } else {
            win.showLibrary();
          }
        }
      } catch (e) {
        log('main', 'guide routing error:', e.message);
      } finally {
        guideBusy = false;
      }
    });

    // Controller navigation: evdev → renderer (only while we're on screen —
    // gameplay input must not drive a hidden launcher).
    evdev.on('action', (action) => { if (win.isVisible()) win.send('pad:action', action); });
    evdev.on('dirs', (dirs) => { if (win.isVisible()) win.send('pad:dirs', dirs); });
    evdev.on('brand', (brand) => win.send('pad:brand', brand));

    config.onChange((c) => {
      evdev.debounceMs = c.guideButton.debounceMs;
      win.send('config:updated', c);
    });
  });

  process.on('uncaughtException', (e) => log('main', 'UNCAUGHT:', e.stack || e.message));
  process.on('unhandledRejection', (e) => log('main', 'UNHANDLED REJECTION:', (e && e.stack) || e));

  app.on('window-all-closed', () => { log('main', 'window-all-closed → quit'); app.quit(); });
  app.on('before-quit', () => {
    evdev.stop();
    sysmon.stop();
    library.stop();
    lifecycle.stop();
    log('main', 'launcher exiting');
  });
}
