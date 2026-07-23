'use strict';
// Kiosk BrowserWindow: fullscreen frameless, resolution-change aware, with
// explicit focus handoff to/from games via xdotool (win.focus() alone is not
// trusted against xfwm4 focus-stealing prevention).
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const x11 = require('./x11');
const { log } = require('./logger');

class LauncherWindow {
  constructor() {
    this.win = null;
    this.xid = null;
    this.mode = 'library'; // library | overlay | hidden
  }

  create() {
    const { bounds } = screen.getPrimaryDisplay();
    this.win = new BrowserWindow({
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      fullscreen: true,
      frame: false,
      show: false,
      backgroundColor: '#0a0c14',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.win.setMenuBarVisibility(false);
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    // Surface renderer console + crashes into the launcher log (black-screen
    // debugging: a renderer JS error otherwise fails silently). Handle both the
    // legacy positional signature and Electron 35+'s details-object form.
    this.win.webContents.on('console-message', (a, b, c, d) => {
      let level, message, line, src;
      if (a && typeof a === 'object' && 'message' in a) {
        ({ level, message, lineNumber: line, sourceId: src } = a);
      } else { level = a; message = b; line = c; src = d; }
      const sev = typeof level === 'string' ? level : ['debug', 'info', 'warning', 'error'][level] || level;
      if (sev === 'error' || sev === 'warning' || level >= 2) {
        log('renderer', `[${sev}] ${message} (${String(src || '').split('/').pop()}:${line})`);
      }
    });
    this.win.webContents.on('render-process-gone', (_e, details) => {
      log('renderer', 'process gone:', details && details.reason);
    });
    this.win.webContents.on('did-fail-load', (_e, code, desc) => {
      log('renderer', 'did-fail-load:', code, desc);
    });

    if (process.env.LAUNCHER_DEVTOOLS) this.win.webContents.openDevTools({ mode: 'right' });
    this.win.once('ready-to-show', () => {
      // Native handle on X11 IS the xid.
      try { this.xid = this.win.getNativeWindowHandle().readUInt32LE(0); }
      catch (e) { log('window', 'xid read failed:', e.message); }
      this.showLibrary();
    });

    // DP-0 mode changes per Moonlight client (set-client-res.sh):
    // re-assert fullscreen bounds; the renderer relayouts on its resize event.
    const refit = () => {
      if (!this.win || this.win.isDestroyed()) return;
      const b = screen.getPrimaryDisplay().bounds;
      log('window', `display change → refit ${b.width}x${b.height}`);
      this.win.setBounds(b);
      this.win.setFullScreen(true);
    };
    screen.on('display-metrics-changed', refit);
    screen.on('display-added', refit);
    screen.on('display-removed', refit);
    return this.win;
  }

  send(channel, payload) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  async activateSelf() {
    if (this.xid) await x11.activate(this.xid);
    else this.win.focus();
  }

  showLibrary() {
    this.mode = 'library';
    this.win.setAlwaysOnTop(false);
    this.win.show();
    this.send('visibility', { visible: true, mode: 'library' });
    this.activateSelf();
  }

  // Overlay = the same window, on top of the (still running) game.
  showOverlay(appid) {
    this.mode = 'overlay';
    this.win.show();
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.moveTop();
    this.send('visibility', { visible: true, mode: 'overlay', appid });
    this.activateSelf();
    // Steam may react to the same Guide press (its "Open Steam Home" binding)
    // and win the focus race — re-assert shortly after.
    setTimeout(() => {
      if (this.mode === 'overlay') { this.win.moveTop(); this.activateSelf(); }
    }, 450);
  }

  hide() {
    this.mode = 'hidden';
    this.win.setAlwaysOnTop(false);
    this.send('visibility', { visible: false, mode: 'hidden' });
    this.win.hide();
  }

  isVisible() { return this.win && this.win.isVisible(); }
}

module.exports = { LauncherWindow };
