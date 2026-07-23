// Input manager: consumes semantic controller events fed from the main
// process's evdev reader (see main/evdev.js — the web Gamepad API is NOT used;
// it goes blind once Steam Input attaches to a pad), plus a keyboard mirror.
// Actions: left right up down confirm cancel alt alt2 menu view lb rb debug
import { glyphSet } from './brand.mjs';

const REPEAT_DELAY = 420;   // ms before a held direction repeats
const REPEAT_RATE = 110;    // ms between repeats

export class InputManager {
  constructor() {
    this.listeners = new Set();
    this.brandListeners = new Set();
    this.brand = 'generic';
    this.detectedBrand = 'generic';
    this.brandOverride = 'auto';
    this.dirs = { left: false, right: false, up: false, down: false };
    this.holdTimers = {};
    this.enabled = true;

    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  onAction(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onBrand(fn) { this.brandListeners.add(fn); return () => this.brandListeners.delete(fn); }

  emit(action, meta = {}) {
    for (const fn of this.listeners) fn(action, meta);
  }

  // ---- brand / glyphs ----

  setBrandOverride(v) {
    this.brandOverride = v || 'auto';
    this.applyBrand();
  }

  setDetectedBrand(brand) {
    this.detectedBrand = brand || 'generic';
    this.applyBrand();
  }

  applyBrand() {
    const next = this.brandOverride !== 'auto' ? this.brandOverride : this.detectedBrand;
    if (next !== this.brand) {
      this.brand = next;
      for (const fn of this.brandListeners) fn(next);
    }
  }

  // ---- controller feed (from main process via IPC) ----

  feedAction(action) {
    if (!this.enabled) return;
    this.emit(action);
  }

  feedDirs(dirs) {
    if (!this.enabled) return;
    for (const d of ['left', 'right', 'up', 'down']) {
      if (dirs[d] && !this.dirs[d]) {
        this.emit(d);
        this.startRepeat(d);
      } else if (!dirs[d] && this.dirs[d]) {
        this.stopRepeat(d);
      }
    }
    this.dirs = { ...dirs };
  }

  startRepeat(d) {
    this.stopRepeat(d);
    this.holdTimers[d + '_delay'] = setTimeout(() => {
      this.holdTimers[d] = setInterval(() => {
        if (this.dirs[d]) this.emit(d, { repeat: true });
      }, REPEAT_RATE);
    }, REPEAT_DELAY);
  }

  stopRepeat(d) {
    clearInterval(this.holdTimers[d]);
    clearTimeout(this.holdTimers[d + '_delay']);
  }

  // ---- lifecycle ----

  start() { this.enabled = true; }

  stop() {
    this.enabled = false;
    for (const d of ['left', 'right', 'up', 'down']) this.stopRepeat(d);
    this.dirs = { left: false, right: false, up: false, down: false };
  }

  // ---- keyboard mirror ----

  onKey(e) {
    const km = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      Enter: 'confirm', Escape: 'cancel', KeyS: 'alt', KeyX: 'alt2',
      KeyQ: 'lb', KeyE: 'rb', F12: 'debug', Tab: 'menu',
    };
    const action = km[e.code];
    if (action) {
      e.preventDefault();
      this.emit(action, { keyboard: true });
    }
  }
}

export { glyphSet };
