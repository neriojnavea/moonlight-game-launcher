'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('brand detection from Gamepad.id strings', async () => {
  const { detectBrand, buttonMap } = await import('../../renderer/input/brand.mjs');

  assert.equal(detectBrand('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'xbox');
  assert.equal(detectBrand('Microsoft Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)'), 'xbox');
  assert.equal(detectBrand('Sony DualSense (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'ps');
  assert.equal(detectBrand('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)'), 'ps');
  assert.equal(detectBrand('Nintendo Switch Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'), 'nintendo');
  assert.equal(detectBrand('Some Unknown Pad'), 'generic');
  assert.equal(detectBrand(''), 'generic');

  // Nintendo swaps confirm/cancel; everyone else confirms on button 0.
  assert.equal(buttonMap('xbox').confirm, 0);
  assert.equal(buttonMap('ps').confirm, 0);
  assert.equal(buttonMap('nintendo').confirm, 1);
  assert.equal(buttonMap('nintendo').cancel, 0);
});
