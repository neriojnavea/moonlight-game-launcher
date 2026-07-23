'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { log } = require('./logger');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PATH = path.join(ROOT, 'config.default.json');
const USER_PATH = path.join(ROOT, 'config.json');

const emitter = new EventEmitter();
let current = null;

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over) || typeof base !== 'object' || base === null ||
      typeof over !== 'object' || over === null) {
    return over === undefined ? base : over;
  }
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
  return out;
}

function load() {
  const defaults = JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf8'));
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(USER_PATH, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') log('config', 'config.json unreadable, using defaults:', e.message);
  }
  current = deepMerge(defaults, user);
  return current;
}

function get() {
  return current || load();
}

function set(patch) {
  current = deepMerge(get(), patch);
  fs.writeFileSync(USER_PATH, JSON.stringify(current, null, 2) + '\n');
  log('config', 'saved', patch);
  emitter.emit('change', current);
  return current;
}

module.exports = { get, set, load, onChange: (fn) => emitter.on('change', fn) };
