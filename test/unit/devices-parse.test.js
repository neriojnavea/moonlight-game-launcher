'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseDevices } = require('../../main/evdev');

// Trimmed real-world fixture: a keyboard, Sunshine's absolute mouse (which
// gets js0 but is NOT a gamepad), and an Xbox pad (BTN_MODE = bit 316 set).
const FIXTURE = `I: Bus=0011 Vendor=0001 Product=0001 Version=ab41
N: Name="AT Translated Set 2 keyboard"
P: Phys=isa0060/serio0/input0
H: Handlers=sysrq kbd event0 leds
B: KEY=402000000 3803078f800d001 feffffdfffefffff fffffffffffffffe

I: Bus=0006 Vendor=0000 Product=0000 Version=0000
N: Name="Mouse passthrough (absolute)"
P: Phys=
H: Handlers=js0 event13 mouse1
B: KEY=1f0000 0 0 0 0

I: Bus=0003 Vendor=045e Product=028e Version=0114
N: Name="Microsoft X-Box 360 pad"
P: Phys=
H: Handlers=js1 event14
B: KEY=7cdb000000000000 0 0 0 0
`;

test('finds all devices with their event numbers', () => {
  const devs = parseDevices(FIXTURE);
  assert.equal(devs.length, 3);
  assert.deepEqual(devs.map((d) => d.event), [0, 13, 14]);
});

test('only the pad has BTN_MODE — js0 alone does NOT make a gamepad', () => {
  const devs = parseDevices(FIXTURE);
  const byName = Object.fromEntries(devs.map((d) => [d.name, d]));
  assert.equal(byName['Microsoft X-Box 360 pad'].hasBtnMode, true);
  assert.equal(byName['Mouse passthrough (absolute)'].hasBtnMode, false);
  assert.equal(byName['AT Translated Set 2 keyboard'].hasBtnMode, false);
});

test('vendor/product captured for brand hints', () => {
  const pad = parseDevices(FIXTURE).find((d) => d.hasBtnMode);
  assert.equal(pad.vendor, '045e');
});
