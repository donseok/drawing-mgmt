import { describe, it, expect } from 'vitest';

import {
  centroid,
  distance,
  dxfUnitFromInsunits,
  formatArea,
  formatLength,
  midpoint,
  polygonArea,
  polygonPerimeter,
  polylineLength,
} from '@/lib/viewer/measurements';

// R39 V-5 — measurement precision audit.
//
// MeasurementOverlay computes lengths and areas in *native* (DXF world or PDF
// page) units after `screenToNative` projection. The pure helpers exercised
// here are the inner kernel — they must be deterministic and tolerant of
// rotated geometry, degenerate input, and the floating-point accumulation
// patterns we see when polylines run dozens of segments long.
//
// What this file is *not* covering: the projection itself (canvas DPR,
// orthographic camera inverse, CSS-rotated wrappers) — those run in DOM and
// belong to integration / e2e suites. We do exercise rotated coordinate sets
// end-to-end against the pure helpers though, since most precision bugs in
// rotated drawings come from the geometry kernel, not the projection.

// Vitest's `toBeCloseTo` defaults to 2 fractional digits. Many of our checks
// need more headroom (sub-mm precision over meter-scale coords), so we pass
// an explicit precision argument: digits=8 ≈ 1e-8 absolute tolerance.
const PRECISION = 8;

// -----------------------------------------------------------------------------
// distance
// -----------------------------------------------------------------------------

describe('distance', () => {
  it('matches Pythagoras for axis-aligned segments', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, PRECISION);
    expect(distance({ x: -3, y: -4 }, { x: 0, y: 0 })).toBeCloseTo(5, PRECISION);
  });

  it('is symmetric (d(a,b) === d(b,a))', () => {
    const a = { x: 17.25, y: -9.5 };
    const b = { x: -8.7, y: 4.0 };
    expect(distance(a, b)).toBeCloseTo(distance(b, a), PRECISION);
  });

  it('returns 0 for identical points (zero-length segment)', () => {
    expect(distance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
    expect(distance({ x: -1e6, y: 5e6 }, { x: -1e6, y: 5e6 })).toBe(0);
  });

  it('handles rotated unit segment without losing precision', () => {
    // Unit segment rotated by an arbitrary angle should remain length 1.
    const angles = [0, Math.PI / 7, Math.PI / 4, Math.PI / 3, Math.PI / 2, 1.234];
    for (const t of angles) {
      const a = { x: 0, y: 0 };
      const b = { x: Math.cos(t), y: Math.sin(t) };
      expect(distance(a, b)).toBeCloseTo(1, PRECISION);
    }
  });

  it('preserves precision at large magnitudes (mm-scale over km coords)', () => {
    // A 0.001 mm segment at coordinates near the AutoCAD model-space limits.
    // Math.hypot is implemented to avoid intermediate overflow / cancellation,
    // so we should still resolve the sub-mm delta.
    const base = 1_000_000;
    const a = { x: base, y: base };
    const b = { x: base + 0.001, y: base };
    expect(distance(a, b)).toBeCloseTo(0.001, 10);
  });
});

// -----------------------------------------------------------------------------
// polylineLength
// -----------------------------------------------------------------------------

describe('polylineLength', () => {
  it('returns 0 for inputs with fewer than 2 points', () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([{ x: 5, y: 5 }])).toBe(0);
  });

  it('matches distance() for a 2-point polyline', () => {
    const pts = [
      { x: 1, y: 1 },
      { x: 4, y: 5 },
    ];
    expect(polylineLength(pts)).toBeCloseTo(distance(pts[0]!, pts[1]!), PRECISION);
    expect(polylineLength(pts)).toBeCloseTo(5, PRECISION);
  });

  it('sums consecutive segments for a V-shape', () => {
    // (0,0) → (3,0) → (3,4): legs of length 3 and 4, total 7.
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    expect(polylineLength(pts)).toBeCloseTo(7, PRECISION);
  });

  it('does not auto-close (open vs closed semantics differ)', () => {
    // A square traced as 4 corners has length 3 sides, not 4.
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polylineLength(square)).toBeCloseTo(30, PRECISION);
    // The 4th edge appears only when polygonPerimeter() closes the ring.
    expect(polygonPerimeter(square)).toBeCloseTo(40, PRECISION);
  });

  it('accumulates 1000 sub-mm segments without losing precision', () => {
    // Many short segments along a straight line — pairwise summation is
    // robust enough at this scale that absolute error stays well under 1e-9.
    // Catches any future regression that switched to a less-stable pattern.
    const N = 1000;
    const step = 0.001; // 1 µm
    const pts = Array.from({ length: N + 1 }, (_, i) => ({ x: i * step, y: 0 }));
    expect(polylineLength(pts)).toBeCloseTo(N * step, 9);
  });

  it('is invariant under rotation (length is a metric)', () => {
    // 6 points along a zigzag, total length 5 + 5 = 10. Rotating every point
    // by an arbitrary angle must not change the polyline length.
    const original = [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 6, y: 0 },
    ];
    const expected = polylineLength(original);
    const rot = (t: number) => (p: { x: number; y: number }) => ({
      x: p.x * Math.cos(t) - p.y * Math.sin(t),
      y: p.x * Math.sin(t) + p.y * Math.cos(t),
    });
    for (const t of [Math.PI / 6, Math.PI / 4, Math.PI / 3, 1.7]) {
      const rotated = original.map(rot(t));
      expect(polylineLength(rotated)).toBeCloseTo(expected, PRECISION);
    }
  });
});

// -----------------------------------------------------------------------------
// polygonArea
// -----------------------------------------------------------------------------

describe('polygonArea', () => {
  it('returns 0 for fewer than 3 points (degenerate)', () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0 }])).toBe(0);
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(0);
  });

  it('computes a 10×10 axis-aligned square', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(square)).toBeCloseTo(100, PRECISION);
  });

  it('is winding-insensitive (CW and CCW yield equal area)', () => {
    const ccw = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const cw = [...ccw].reverse();
    expect(polygonArea(cw)).toBeCloseTo(polygonArea(ccw), PRECISION);
  });

  it('matches the formula for a right triangle (½·b·h)', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 0, y: 8 },
    ];
    expect(polygonArea(tri)).toBeCloseTo(24, PRECISION);
  });

  it('handles concave (L-shape) polygons via Shoelace', () => {
    // L-shape: 6×6 outer minus 3×3 cut-out from the upper-right corner.
    // Outer area 36 − inner cut 9 = 27.
    const lshape = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 6 },
      { x: 0, y: 6 },
    ];
    expect(polygonArea(lshape)).toBeCloseTo(27, PRECISION);
  });

  it('is rotation-invariant (rotated square keeps area = side²)', () => {
    // A square with side 10 rotated by 30° around the origin.
    const t = Math.PI / 6;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const corners = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const rotated = corners.map((p) => ({
      x: p.x * c - p.y * s,
      y: p.x * s + p.y * c,
    }));
    expect(polygonArea(rotated)).toBeCloseTo(100, PRECISION);
  });

  it('is translation-invariant (shifted polygon keeps the same area)', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 7, y: 0 },
      { x: 7, y: 5 },
      { x: 0, y: 5 },
    ];
    const shifted = corners.map((p) => ({ x: p.x + 1234, y: p.y - 567 }));
    expect(polygonArea(shifted)).toBeCloseTo(polygonArea(corners), PRECISION);
    expect(polygonArea(corners)).toBeCloseTo(35, PRECISION);
  });

  it('returns 0 for collinear points (degenerate polygon)', () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(polygonArea(collinear)).toBeCloseTo(0, PRECISION);
  });

  it('returns the algebraic sum of lobes for a self-intersecting figure-8', () => {
    // Documented limitation: Shoelace cannot tell self-intersecting from
    // simple polygons. For a figure-8 with two equal lobes traced in opposite
    // directions, the signed contributions cancel to ~0. We pin this so any
    // future "fix" that changes the contract is intentional and reviewed.
    const fig8 = [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ];
    expect(polygonArea(fig8)).toBeCloseTo(0, PRECISION);
  });
});

// -----------------------------------------------------------------------------
// polygonPerimeter
// -----------------------------------------------------------------------------

describe('polygonPerimeter', () => {
  it('returns 0 for fewer than 3 points', () => {
    expect(polygonPerimeter([])).toBe(0);
    expect(polygonPerimeter([{ x: 0, y: 0 }])).toBe(0);
    expect(
      polygonPerimeter([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ]),
    ).toBe(0);
  });

  it('closes the ring (n+1 segments for n points)', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 4 },
    ];
    // 3 + 4 + 5 = 12 (3-4-5 triangle).
    expect(polygonPerimeter(tri)).toBeCloseTo(12, PRECISION);
  });

  it('equals 4×side for a unit square regardless of rotation', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(polygonPerimeter(square)).toBeCloseTo(4, PRECISION);
    const t = 1.234;
    const rotated = square.map((p) => ({
      x: p.x * Math.cos(t) - p.y * Math.sin(t),
      y: p.x * Math.sin(t) + p.y * Math.cos(t),
    }));
    expect(polygonPerimeter(rotated)).toBeCloseTo(4, PRECISION);
  });
});

// -----------------------------------------------------------------------------
// midpoint / centroid
// -----------------------------------------------------------------------------

describe('midpoint', () => {
  it('lies halfway between the two endpoints', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
    expect(midpoint({ x: -3, y: 7 }, { x: 9, y: -1 })).toEqual({ x: 3, y: 3 });
  });
});

describe('centroid', () => {
  it('returns origin for empty input (defensive)', () => {
    expect(centroid([])).toEqual({ x: 0, y: 0 });
  });

  it('is the arithmetic mean of input points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
      { x: 0, y: 6 },
    ];
    expect(centroid(pts)).toEqual({ x: 3, y: 3 });
  });

  it('is translation-equivariant', () => {
    const pts = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ];
    const shifted = pts.map((p) => ({ x: p.x + 100, y: p.y - 50 }));
    const c = centroid(pts);
    const cs = centroid(shifted);
    expect(cs.x).toBeCloseTo(c.x + 100, PRECISION);
    expect(cs.y).toBeCloseTo(c.y - 50, PRECISION);
  });
});

// -----------------------------------------------------------------------------
// Format helpers (presentation only, but easy to regress)
// -----------------------------------------------------------------------------

describe('formatLength', () => {
  it('drops fractional digits for mm values ≥ 100', () => {
    // Korean locale uses ASCII commas and dots — same as en-US for these
    // magnitudes. Hard-coding the expected string keeps the regression sharp.
    expect(formatLength(1234.5, 'mm')).toBe('1,235 mm');
    expect(formatLength(100, 'mm')).toBe('100 mm');
  });

  it('uses 2 fractional digits for sub-100 mm and non-mm units', () => {
    expect(formatLength(12.345, 'mm')).toBe('12.35 mm');
    expect(formatLength(72, 'pt')).toBe('72.00 pt');
  });

  it('preserves sign on negative values', () => {
    expect(formatLength(-150, 'mm')).toBe('-150 mm');
  });
});

describe('formatArea', () => {
  it('switches to m² when the mm² magnitude is ≥ 1,000,000', () => {
    // 1 m² = 1_000_000 mm² → 1.000 m².
    expect(formatArea(1_000_000, 'mm')).toBe('1.000 m²');
    // 2.5 m².
    expect(formatArea(2_500_000, 'mm')).toBe('2.500 m²');
  });

  it('keeps mm² for sub-million values', () => {
    expect(formatArea(50_000, 'mm')).toBe('50,000 mm²');
    expect(formatArea(99.99, 'mm')).toBe('99.99 mm²');
  });

  it('squares the unit suffix for non-mm units', () => {
    expect(formatArea(72.5, 'pt')).toBe('72.50 pt²');
  });
});

// -----------------------------------------------------------------------------
// dxfUnitFromInsunits — defensive against unknown codes
// -----------------------------------------------------------------------------

describe('dxfUnitFromInsunits', () => {
  it('maps the documented INSUNITS codes', () => {
    expect(dxfUnitFromInsunits(1)).toEqual({ unit: 'in', toMm: 25.4 });
    expect(dxfUnitFromInsunits(4)).toEqual({ unit: 'mm', toMm: 1 });
    expect(dxfUnitFromInsunits(5)).toEqual({ unit: 'cm', toMm: 10 });
    expect(dxfUnitFromInsunits(6)).toEqual({ unit: 'm', toMm: 1000 });
  });

  it('falls back to mm for undefined / unknown / unitless (0)', () => {
    expect(dxfUnitFromInsunits(undefined)).toEqual({ unit: 'mm', toMm: 1 });
    expect(dxfUnitFromInsunits(0)).toEqual({ unit: 'mm', toMm: 1 });
    expect(dxfUnitFromInsunits(999)).toEqual({ unit: 'mm', toMm: 1 });
  });
});

// -----------------------------------------------------------------------------
// End-to-end sanity — rotation of a measurement scenario
// -----------------------------------------------------------------------------

describe('rotation transform sanity', () => {
  // The viewer applies CSS rotation to a wrapper that contains the canvas
  // *and* the measurement overlay. Pointer events therefore arrive in the
  // already-rotated frame, and projection (`screenToNative`) should produce
  // the same world points regardless of the wrapper's rotation. This block
  // simulates that invariant by rotating the input world points through the
  // full pipeline (distance + polygonArea) and asserting equality.
  const cases = [
    { label: '0°', t: 0 },
    { label: '90°', t: Math.PI / 2 },
    { label: '180°', t: Math.PI },
    { label: '270°', t: (3 * Math.PI) / 2 },
    { label: '37° (off-axis)', t: 0.6458 },
  ];

  const square = [
    { x: -5, y: -5 },
    { x: 5, y: -5 },
    { x: 5, y: 5 },
    { x: -5, y: 5 },
  ];

  for (const { label, t } of cases) {
    it(`distance + area unchanged after ${label} rotation`, () => {
      const c = Math.cos(t);
      const s = Math.sin(t);
      const rotated = square.map((p) => ({
        x: p.x * c - p.y * s,
        y: p.x * s + p.y * c,
      }));
      // Diagonal of a 10×10 square = 10√2.
      const diag = distance(rotated[0]!, rotated[2]!);
      expect(diag).toBeCloseTo(10 * Math.SQRT2, PRECISION);
      // Area of a 10×10 square = 100.
      expect(polygonArea(rotated)).toBeCloseTo(100, PRECISION);
      // Perimeter = 40.
      expect(polygonPerimeter(rotated)).toBeCloseTo(40, PRECISION);
    });
  }
});
