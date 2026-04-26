// AutoCAD Color Index (ACI) → 0xRRGGBB integer.
//
// ACI is a 256-slot indexed palette baked into AutoCAD. The first 9 entries
// are the named colors most CAD users actually pick; the rest fill out the
// HSV palette. We map only the named ones explicitly — everything else falls
// back to a deterministic shade derived from the index so layers don't all
// collapse to one color when the doc uses indices > 9.
//
// References:
//   - LibreCAD's RColor::intToRgb()
//   - ezdxf docs

/** Special sentinel codes. */
export const ACI_BY_BLOCK = 0;
export const ACI_BY_LAYER = 256;

/** Default visible color for ACI 7 — black on a light background. Adjust at
 *  render time when the canvas is dark. */
export const DEFAULT_FOREGROUND = 0x000000;

const NAMED: Record<number, number> = {
  1: 0xff0000, // red
  2: 0xffff00, // yellow
  3: 0x00ff00, // green
  4: 0x00ffff, // cyan
  5: 0x0000ff, // blue
  6: 0xff00ff, // magenta
  7: DEFAULT_FOREGROUND,
  8: 0x808080, // dark gray
  9: 0xc0c0c0, // light gray
};

/**
 * Resolve an ACI index to a 0xRRGGBB integer. `layerColor` is consulted when
 * the entity color is `ByLayer` (256) so the caller can compose the lookup
 * once per entity without branching twice.
 */
export function aciToRgb(index: number, layerColor?: number): number {
  if (index === ACI_BY_LAYER && typeof layerColor === 'number') {
    return aciToRgb(layerColor);
  }
  if (index === ACI_BY_BLOCK || index === ACI_BY_LAYER) {
    return DEFAULT_FOREGROUND;
  }
  if (NAMED[index] !== undefined) return NAMED[index]!;

  // Deterministic fallback for unhandled indices — golden-angle hue rotation
  // around HSV gives visually distinct colors without a 256-row palette table.
  // Saturation/value are fixed mid-range so the result reads on white and dark
  // backgrounds alike.
  const hue = (index * 137.508) % 360;
  return hsvToRgb(hue, 0.55, 0.55);
}

function hsvToRgb(h: number, s: number, v: number): number {
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c; g = x; b = 0;
  } else if (hp < 2) {
    r = x; g = c; b = 0;
  } else if (hp < 3) {
    r = 0; g = c; b = x;
  } else if (hp < 4) {
    r = 0; g = x; b = c;
  } else if (hp < 5) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  const m = v - c;
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}
