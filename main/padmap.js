'use strict';
// Pure gamepad-mapping helpers for the evdev input path (unit-tested).
//
// Kernel key codes differ per driver: xpad (Xbox) puts X on 307/BTN_NORTH and
// Y on 308/BTN_WEST despite X being physically WEST; hid-playstation puts
// triangle on 307 and square on 308. Our semantic actions are bound to
// PHYSICAL positions: confirm=south, cancel=east (swapped on Nintendo),
// alt(suspend)=west, alt2(close)=north.

const ABS_X = 0, ABS_Y = 1, ABS_HAT0X = 16, ABS_HAT0Y = 17;
const NAV_ABS = new Set([ABS_X, ABS_Y, ABS_HAT0X, ABS_HAT0Y]);

// vendor id (lowercase hex, no 0x) → glyph/mapping brand
function vendorToBrand(vendor) {
  switch ((vendor || '').toLowerCase()) {
    case '054c': return 'ps';
    case '057e': return 'nintendo';
    case '045e': return 'xbox';
    case '28de': return 'xbox'; // Steam Virtual Gamepad emulates X360
    default: return 'generic';
  }
}

// EV_KEY code + brand → semantic action (null = not a nav button)
function actionForKey(code, brand) {
  switch (code) {
    case 304: return brand === 'nintendo' ? 'cancel' : 'confirm'; // BTN_SOUTH
    case 305: return brand === 'nintendo' ? 'confirm' : 'cancel'; // BTN_EAST
    case 307: // BTN_NORTH: Xbox X (west) / PS triangle (north) / Switch X (north)
      return brand === 'xbox' || brand === 'generic' ? 'alt' : 'alt2';
    case 308: // BTN_WEST: Xbox Y (north) / PS square (west) / Switch Y (west)
      return brand === 'xbox' || brand === 'generic' ? 'alt2' : 'alt';
    case 310: return 'lb';    // BTN_TL
    case 311: return 'rb';    // BTN_TR
    case 314: return 'view';  // BTN_SELECT
    case 315: return 'menu';  // BTN_START
    default: return null;
  }
}

// Axis calibration: Sony pads report 0..255 centered at 128; everything else
// on this host (Sunshine XOne virtual, Steam virtual X360, physical Xbox,
// hid-nintendo) reports signed 16-bit.
function axisCal(vendor) {
  return (vendor || '').toLowerCase() === '054c'
    ? { center: 128, span: 127 }
    : { center: 0, span: 32768 };
}

const ENGAGE = 0.45, RELEASE = 0.30; // hysteresis on normalized stick

// state: {x, y, hatX, hatY} raw values; prev: {left,right,up,down}
// Returns new dirs object (hat is authoritative when non-zero).
function dirsFromState(state, cal, prev) {
  const nx = (state.x - cal.center) / cal.span;
  const ny = (state.y - cal.center) / cal.span;
  const on = (active, v) => (active ? Math.abs(v) > RELEASE : Math.abs(v) > ENGAGE);
  return {
    left: state.hatX < 0 || (nx < 0 && on(prev.left, nx)),
    right: state.hatX > 0 || (nx > 0 && on(prev.right, nx)),
    up: state.hatY < 0 || (ny < 0 && on(prev.up, ny)),
    down: state.hatY > 0 || (ny > 0 && on(prev.down, ny)),
  };
}

function applyAbs(state, code, value) {
  switch (code) {
    case ABS_X: state.x = value; break;
    case ABS_Y: state.y = value; break;
    case ABS_HAT0X: state.hatX = value; break;
    case ABS_HAT0Y: state.hatY = value; break;
    default: return false;
  }
  return true;
}

module.exports = {
  vendorToBrand, actionForKey, axisCal, dirsFromState, applyAbs,
  NAV_ABS, ENGAGE, RELEASE,
};
