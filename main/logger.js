'use strict';
const fs = require('fs');
const { RUN } = require('./util');

const LOG_PATH = `${RUN}/launcher.log`;
let stream = null;

function ts() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, '');
}

function open() {
  if (!stream) {
    try {
      stream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
    } catch {
      stream = null;
    }
  }
  return stream;
}

const listeners = new Set();

function log(tag, ...parts) {
  const line = `${ts()} [${tag}] ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`;
  const s = open();
  if (s) s.write(line + '\n');
  // eslint-disable-next-line no-console
  console.log(line);
  for (const fn of listeners) {
    try { fn(line); } catch { /* debug tap must never break logging */ }
  }
}

// Debug screen live-tail hook.
function onLine(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { log, onLine, LOG_PATH };
