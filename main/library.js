'use strict';
// Steam library via the Python bridge (single source of truth for filtering
// and box-art rules). Caches the last good result so a bridge failure
// degrades to stale data, never a blank rail.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { run, HOME } = require('./util');
const { log } = require('./logger');

const BRIDGE = path.join(__dirname, '..', 'tools', 'steam-library.py');
const STEAM = `${HOME}/.local/share/Steam`;

class Library extends EventEmitter {
  constructor() {
    super();
    this.games = [];
    this.lastError = null;
    this.lastSync = 0;
    this.watchers = [];
    this.refreshTimer = null;
    this.refreshing = null;
  }

  async refresh({ art = true } = {}) {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this._refresh({ art }).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async _refresh({ art }) {
    const args = [BRIDGE];
    if (!art) args.push('--no-art');
    const r = await run('python3', args, { timeout: 120000 });
    if (r.code !== 0) {
      this.lastError = (r.stderr || 'bridge failed').trim().split('\n').pop();
      log('library', 'bridge failed:', this.lastError);
      this.emit('updated', this.snapshot());
      return this.snapshot();
    }
    try {
      const data = JSON.parse(r.stdout);
      this.games = data.games;
      this.lastError = null;
      this.lastSync = Date.now();
      log('library', `${this.games.length} games`);
    } catch (e) {
      this.lastError = `bad bridge output: ${e.message}`;
      log('library', this.lastError);
    }
    this.emit('updated', this.snapshot());
    return this.snapshot();
  }

  snapshot() {
    return { games: this.games, lastError: this.lastError, lastSync: this.lastSync };
  }

  byId(appid) {
    return this.games.find((g) => g.appid === String(appid)) || null;
  }

  // Watch every <library>/steamapps dir for appmanifest changes (install/uninstall).
  watchSteamApps() {
    const dirs = new Set([`${STEAM}/steamapps`]);
    try {
      const vdf = fs.readFileSync(`${STEAM}/steamapps/libraryfolders.vdf`, 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) dirs.add(`${m[1]}/steamapps`);
    } catch { /* default lib only */ }
    for (const dir of dirs) {
      try {
        const w = fs.watch(dir, (_evt, file) => {
          if (!file || !/^appmanifest_\d+\.acf$/.test(file)) return;
          clearTimeout(this.refreshTimer);
          this.refreshTimer = setTimeout(() => {
            log('library', `manifest change in ${dir} → refresh`);
            this.refresh({ art: true });
          }, 3000);
        });
        this.watchers.push(w);
      } catch (e) {
        log('library', `cannot watch ${dir}:`, e.message);
      }
    }
  }

  stop() {
    for (const w of this.watchers) w.close();
    clearTimeout(this.refreshTimer);
  }
}

module.exports = { Library };
