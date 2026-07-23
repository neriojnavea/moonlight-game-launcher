'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  vendorToBrand, actionForKey, axisCal, dirsFromState, applyAbs,
} = require('../../main/padmap');

test('vendor → brand', () => {
  assert.equal(vendorToBrand('045e'), 'xbox');
  assert.equal(vendorToBrand('054c'), 'ps');
  assert.equal(vendorToBrand('057e'), 'nintendo');
  assert.equal(vendorToBrand('28de'), 'xbox'); // Steam Virtual Gamepad = X360
  assert.equal(vendorToBrand('dead'), 'generic');
});

test('face buttons map by physical position per brand', () => {
  // Xbox: A(304) confirm, B(305) cancel, X(307) alt, Y(308) alt2
  assert.equal(actionForKey(304, 'xbox'), 'confirm');
  assert.equal(actionForKey(305, 'xbox'), 'cancel');
  assert.equal(actionForKey(307, 'xbox'), 'alt');
  assert.equal(actionForKey(308, 'xbox'), 'alt2');
  // Nintendo swaps confirm/cancel (A is physically EAST)
  assert.equal(actionForKey(305, 'nintendo'), 'confirm');
  assert.equal(actionForKey(304, 'nintendo'), 'cancel');
  // PS: square(308)=alt (west), triangle(307)=alt2 (north)
  assert.equal(actionForKey(308, 'ps'), 'alt');
  assert.equal(actionForKey(307, 'ps'), 'alt2');
  // System buttons
  assert.equal(actionForKey(310, 'xbox'), 'lb');
  assert.equal(actionForKey(311, 'xbox'), 'rb');
  assert.equal(actionForKey(314, 'xbox'), 'view');
  assert.equal(actionForKey(315, 'xbox'), 'menu');
  assert.equal(actionForKey(999, 'xbox'), null);
});

test('dpad hat is authoritative', () => {
  const state = { x: 0, y: 0, hatX: 0, hatY: 0 };
  const cal = axisCal('045e');
  const rest = { left: false, right: false, up: false, down: false };
  applyAbs(state, 16, -1); // ABS_HAT0X left
  assert.equal(dirsFromState(state, cal, rest).left, true);
  applyAbs(state, 16, 0);
  applyAbs(state, 17, 1); // ABS_HAT0Y down
  const d = dirsFromState(state, cal, rest);
  assert.deepEqual(d, { left: false, right: false, up: false, down: true });
});

test('16-bit stick with hysteresis', () => {
  const cal = axisCal('045e'); // signed 16-bit
  const state = { x: 0, y: 0, hatX: 0, hatY: 0 };
  const rest = { left: false, right: false, up: false, down: false };
  applyAbs(state, 0, 16000); // 0.49 > 0.45 engage
  let d = dirsFromState(state, cal, rest);
  assert.equal(d.right, true);
  applyAbs(state, 0, 12000); // 0.37: above release(0.30) → stays engaged
  d = dirsFromState(state, cal, d);
  assert.equal(d.right, true);
  applyAbs(state, 0, 8000); // 0.24 < release → off
  d = dirsFromState(state, cal, d);
  assert.equal(d.right, false);
  // 0.37 does NOT engage from rest (below 0.45)
  applyAbs(state, 0, 12000);
  assert.equal(dirsFromState(state, cal, rest).right, false);
});

test('Sony 0..255 axes are centered at 128', () => {
  const cal = axisCal('054c');
  const state = { x: 128, y: 128, hatX: 0, hatY: 0 };
  const rest = { left: false, right: false, up: false, down: false };
  assert.deepEqual(dirsFromState(state, cal, rest), rest); // at rest
  applyAbs(state, 1, 10); // up: (10-128)/127 = -0.93
  assert.equal(dirsFromState(state, cal, rest).up, true);
  applyAbs(state, 1, 250);
  assert.equal(dirsFromState(state, cal, rest).down, true);
});
