'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseInputEvent, keyBitmaskHas, EVENT_SIZE, BTN_MODE } = require('../../main/evdev');

function makeEvent(type, code, value) {
  const buf = Buffer.alloc(EVENT_SIZE);
  buf.writeBigUInt64LE(1234n, 0);   // tv_sec
  buf.writeBigUInt64LE(5678n, 8);   // tv_usec
  buf.writeUInt16LE(type, 16);
  buf.writeUInt16LE(code, 18);
  buf.writeInt32LE(value, 20);
  return buf;
}

test('parses a guide-button press (EV_KEY BTN_MODE value=1)', () => {
  const evt = parseInputEvent(makeEvent(1, BTN_MODE, 1));
  assert.deepEqual(evt, { type: 1, code: 316, value: 1 });
});

test('parses at an offset within a multi-event chunk', () => {
  const chunk = Buffer.concat([makeEvent(3, 0, -32000), makeEvent(1, 304, 1)]);
  assert.deepEqual(parseInputEvent(chunk, 0), { type: 3, code: 0, value: -32000 });
  assert.deepEqual(parseInputEvent(chunk, EVENT_SIZE), { type: 1, code: 304, value: 1 });
});

test('negative ABS values decode as signed', () => {
  const evt = parseInputEvent(makeEvent(3, 1, -1));
  assert.equal(evt.value, -1);
});

test('keyBitmaskHas finds bit 316 (word 4 from the right, bit 60)', () => {
  // Real Xbox pad KEY line shape: bit 316 set → word index 4 from right has bit 60.
  const words = ['1000000000000000', '0', '0', '0', '0'];
  assert.equal(keyBitmaskHas(words, 316), true);
  assert.equal(keyBitmaskHas(words, 315), false);
});

test('keyboard-like KEY bitmask has no BTN_MODE', () => {
  const words = ['fffffffffffffffe'];
  assert.equal(keyBitmaskHas(words, 316), false);
});
