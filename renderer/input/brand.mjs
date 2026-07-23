// Pure controller-brand detection from Gamepad.id — unit-tested by node.
// Note: over Moonlight the id reflects the pad SUNSHINE EMULATES, which is
// usually but not always the physical pad's brand; config `glyphs` overrides.

export function detectBrand(id) {
  if (!id) return 'generic';
  const s = id.toLowerCase();
  // Vendor ids commonly embedded in Gamepad.id ("Vendor: 054c Product: 0ce6").
  if (/054c/.test(s) || /sony|dualsense|dualshock|playstation|ps[345]/.test(s)) return 'ps';
  if (/057e/.test(s) || /nintendo|switch|joy-?con|pro controller/.test(s)) return 'nintendo';
  if (/045e/.test(s) || /x-?box|xinput|microsoft/.test(s)) return 'xbox';
  return 'generic';
}

// Standard-mapping button indices per brand. Nintendo pads physically swap
// A/B (confirm is EAST, cancel is SOUTH), so confirm/cancel flip there.
export function buttonMap(brand) {
  if (brand === 'nintendo') return { confirm: 1, cancel: 0, alt: 3, alt2: 2 };
  return { confirm: 0, cancel: 1, alt: 2, alt2: 3 };
}

// Display labels for the four face buttons + system buttons, by brand.
export function glyphSet(brand) {
  switch (brand) {
    case 'ps':
      return {
        confirm: { text: '✕', cls: 'gp gp-cross' },
        cancel: { text: '○', cls: 'gp gp-circle' },
        alt: { text: '□', cls: 'gp gp-square' },
        alt2: { text: '△', cls: 'gp gp-triangle' },
        menu: { text: '≡', cls: '' }, view: { text: '⧉', cls: '' }, home: { text: 'PS', cls: '' },
      };
    case 'nintendo':
      return {
        confirm: { text: 'A', cls: '' },
        cancel: { text: 'B', cls: '' },
        alt: { text: 'Y', cls: '' },
        alt2: { text: 'X', cls: '' },
        menu: { text: '+', cls: '' }, view: { text: '−', cls: '' }, home: { text: '⌂', cls: '' },
      };
    case 'xbox':
      return {
        confirm: { text: 'A', cls: 'gx-a' },
        cancel: { text: 'B', cls: 'gx-b' },
        alt: { text: 'X', cls: 'gx-x' },
        alt2: { text: 'Y', cls: 'gx-y' },
        menu: { text: '≡', cls: '' }, view: { text: '⧉', cls: '' }, home: { text: '⌂', cls: '' },
      };
    default:
      return {
        confirm: { text: 'A', cls: '' },
        cancel: { text: 'B', cls: '' },
        alt: { text: 'X', cls: '' },
        alt2: { text: 'Y', cls: '' },
        menu: { text: '≡', cls: '' }, view: { text: '⧉', cls: '' }, home: { text: '⌂', cls: '' },
      };
  }
}
