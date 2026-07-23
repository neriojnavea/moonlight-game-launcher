'use strict';
// Raw evdev gamepad reader — the ONLY controller input path for the launcher.
//
// The web Gamepad API breaks here as soon as Steam Input attaches to a pad
// (grab races, hotplug, focus gating), while raw evdev keeps delivering —
// so ALL navigation comes from this reader, forwarded to the renderer over
// IPC. The user is in the `input` group; no native deps, struct parsing only.
//
// Hotplug is the NORMAL case: Sunshine creates its uinput gamepad only while
// a Moonlight client streams with a pad attached, and Steam Input may grab it
// and re-emit a "Steam Virtual Gamepad". We open EVERY device advertising
// BTN_MODE and de-dupe presses across devices (one physical press can echo).
const fs = require('fs');
const { EventEmitter } = require('events');
const { log } = require('./logger');
const padmap = require('./padmap');

const EV_KEY = 1;
const EV_ABS = 3;
const BTN_MODE = 316;
const BTN_SELECT = 314;
const BTN_START = 315;
const EVENT_SIZE = 24; // x86_64: 16B timeval + u16 type + u16 code + s32 value
const ECHO_MS = 50;    // cross-device duplicate-press window

// ---- pure, unit-tested parsing ---------------------------------------------

function parseInputEvent(buf, offset = 0) {
  return {
    type: buf.readUInt16LE(offset + 16),
    code: buf.readUInt16LE(offset + 18),
    value: buf.readInt32LE(offset + 20),
  };
}

// words: the space-separated hex words of a "B: KEY=" line (leftmost = highest bits).
function keyBitmaskHas(words, bit) {
  let acc = 0n;
  for (const w of words) acc = (acc << 64n) | BigInt('0x' + w);
  return ((acc >> BigInt(bit)) & 1n) === 1n;
}

// Parse /proc/bus/input/devices. A device is a gamepad iff its KEY bitmask
// has bit 316 (BTN_MODE) — "has jsN" is NOT valid on this host (Sunshine's
// absolute mouse gets js0).
function parseDevices(text) {
  const devices = [];
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue;
    const dev = { name: '', vendor: '', product: '', event: null, handlers: '', hasBtnMode: false };
    for (const line of block.split('\n')) {
      let m;
      if ((m = line.match(/^I: Bus=\S+ Vendor=(\S+) Product=(\S+)/))) {
        dev.vendor = m[1]; dev.product = m[2];
      } else if ((m = line.match(/^N: Name="(.*)"/))) {
        dev.name = m[1];
      } else if ((m = line.match(/^H: Handlers=(.*)$/))) {
        dev.handlers = m[1].trim();
        const ev = m[1].match(/event(\d+)/);
        if (ev) dev.event = Number(ev[1]);
      } else if ((m = line.match(/^B: KEY=(.*)$/))) {
        dev.hasBtnMode = keyBitmaskHas(m[1].trim().split(/\s+/), BTN_MODE);
      }
    }
    if (dev.event !== null) devices.push(dev);
  }
  return devices;
}

// ---- live reader ------------------------------------------------------------
// Emits:
//   'guide'            de-duped Guide/Home press
//   'action', name     semantic press: confirm/cancel/alt/alt2/lb/rb/view/menu/debug
//   'dirs', {left,right,up,down}   merged direction state (dpad + left stick)
//   'brand', name      xbox/ps/nintendo — from the most recently active pad
//   'event', {...}     raw tap for the Debug screen
//   'devices', [...]   device list after each rescan

class EvdevReader extends EventEmitter {
  constructor({ debounceMs = 400 } = {}) {
    super();
    this.debounceMs = debounceMs;
    this.streams = new Map();   // event number -> ReadStream
    this.pads = new Map();      // event number -> per-device state
    this.devices = [];
    this.lastGuide = 0;
    this.lastPress = new Map(); // key code -> {t, event} for echo de-dupe
    this.globalDirs = { left: false, right: false, up: false, down: false };
    this.activeBrand = 'generic';
    this.rescanTimer = null;
    this.watcher = null;
  }

  start() {
    this.rescan();
    try {
      this.watcher = fs.watch('/dev/input', () => {
        clearTimeout(this.rescanTimer);
        this.rescanTimer = setTimeout(() => this.rescan(), 300);
      });
    } catch (e) {
      log('evdev', 'cannot watch /dev/input:', e.message);
    }
  }

  stop() {
    if (this.watcher) this.watcher.close();
    clearTimeout(this.rescanTimer);
    for (const s of this.streams.values()) s.destroy();
    this.streams.clear();
    this.pads.clear();
  }

  rescan() {
    let text = '';
    try { text = fs.readFileSync('/proc/bus/input/devices', 'utf8'); } catch (e) {
      log('evdev', 'cannot read /proc/bus/input/devices:', e.message);
      return;
    }
    this.devices = parseDevices(text);
    const gamepads = this.devices.filter((d) => d.hasBtnMode);

    for (const [ev, stream] of this.streams) {
      if (!gamepads.some((d) => d.event === ev)) {
        stream.destroy();
        this.streams.delete(ev);
        this.pads.delete(ev);
        log('evdev', `closed event${ev} (device gone)`);
      }
    }
    for (const pad of gamepads) {
      if (this.streams.has(pad.event)) continue;
      this.open(pad);
    }
    this.mergeDirs(); // a vanished device must not leave a direction stuck on
    this.emit('devices', this.devices);
  }

  open(pad) {
    const path = `/dev/input/event${pad.event}`;
    let stream;
    try {
      stream = fs.createReadStream(path);
    } catch (e) {
      log('evdev', `open ${path} failed:`, e.message);
      return;
    }
    log('evdev', `reading ${path} (${pad.name})`);
    this.pads.set(pad.event, {
      info: pad,
      brand: padmap.vendorToBrand(pad.vendor),
      axes: { x: 0, y: 0, hatX: 0, hatY: 0 },
      dirs: { left: false, right: false, up: false, down: false },
      held: new Set(),
    });
    let remainder = Buffer.alloc(0);
    stream.on('data', (chunk) => {
      let buf = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
      let off = 0;
      for (; off + EVENT_SIZE <= buf.length; off += EVENT_SIZE) {
        this.handleEvent(pad, parseInputEvent(buf, off));
      }
      remainder = buf.subarray(off);
    });
    stream.on('error', (e) => {
      log('evdev', `${path} error:`, e.message);
      stream.destroy();
      this.streams.delete(pad.event);
      this.pads.delete(pad.event);
      this.mergeDirs();
    });
    stream.on('close', () => { this.streams.delete(pad.event); });
    this.streams.set(pad.event, stream);
  }

  handleEvent(pad, evt) {
    const st = this.pads.get(pad.event);
    if (!st) return;
    if (this.listenerCount('event') && (evt.type === EV_KEY || evt.type === EV_ABS)) {
      this.emit('event', { device: `event${pad.event}`, name: pad.name, ...evt });
    }

    if (evt.type === EV_KEY) {
      if (evt.value === 0) { st.held.delete(evt.code); return; }
      if (evt.value !== 1) return; // no autorepeat handling for pads

      if (evt.code === BTN_MODE) {
        const now = Date.now();
        if (now - this.lastGuide < this.debounceMs) return;
        this.lastGuide = now;
        log('evdev', `guide press from event${pad.event} (${pad.name})`);
        this.emit('guide');
        return;
      }

      // Cross-device echo de-dupe (Sunshine pad + Steam virtual mirror).
      const now = Date.now();
      const last = this.lastPress.get(evt.code);
      if (last && last.event !== pad.event && now - last.t < ECHO_MS) return;
      this.lastPress.set(evt.code, { t: now, event: pad.event });

      this.updateBrand(st);

      // View+Menu chord → debug screen.
      if ((evt.code === BTN_SELECT && st.held.has(BTN_START)) ||
          (evt.code === BTN_START && st.held.has(BTN_SELECT))) {
        st.held.add(evt.code);
        this.emit('action', 'debug');
        return;
      }
      st.held.add(evt.code);

      const action = padmap.actionForKey(evt.code, this.activeBrand);
      if (action) this.emit('action', action);
      return;
    }

    if (evt.type === EV_ABS && padmap.NAV_ABS.has(evt.code)) {
      if (!padmap.applyAbs(st.axes, evt.code, evt.value)) return;
      const next = padmap.dirsFromState(st.axes, padmap.axisCal(pad.vendor), st.dirs);
      if (next.left !== st.dirs.left || next.right !== st.dirs.right ||
          next.up !== st.dirs.up || next.down !== st.dirs.down) {
        st.dirs = next;
        this.updateBrand(st);
        this.mergeDirs();
      }
    }
  }

  // Global direction state = OR across devices (echo devices agree, so
  // duplicates are naturally harmless).
  mergeDirs() {
    const merged = { left: false, right: false, up: false, down: false };
    for (const st of this.pads.values()) {
      for (const d of ['left', 'right', 'up', 'down']) merged[d] = merged[d] || st.dirs[d];
    }
    if (merged.left !== this.globalDirs.left || merged.right !== this.globalDirs.right ||
        merged.up !== this.globalDirs.up || merged.down !== this.globalDirs.down) {
      this.globalDirs = merged;
      this.emit('dirs', merged);
    }
  }

  updateBrand(st) {
    if (st.brand !== 'generic' && st.brand !== this.activeBrand) {
      this.activeBrand = st.brand;
      this.emit('brand', st.brand);
    }
  }
}

module.exports = { EvdevReader, parseInputEvent, parseDevices, keyBitmaskHas, BTN_MODE, EVENT_SIZE };
