import { describe, it, expect } from 'vitest';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { buildScene, resolveLineWeightPx } from '@/components/DwgViewer/scene';
import type { DxfDocument } from '@/lib/dxf-parser';

// R37 V-2 — line-weight promotion to Line2 + LineMaterial.
//
// These tests exercise the pure pipeline (parser-side typings → scene
// builder) without spinning up a WebGLRenderer. happy-dom doesn't ship a
// WebGL2 context, so we never call `renderer.render` here; LineMaterial
// instances are inspectable purely as JS objects.

describe('resolveLineWeightPx', () => {
  it('uses the entity weight when it is non-negative (1/100 mm → px linear @ 4×)', () => {
    // 13 (= 0.13 mm) maps to ~0.52 px, but the floor is 1.0 px.
    expect(resolveLineWeightPx(13, undefined)).toBeCloseTo(1.0);
    // 50 (= 0.50 mm) → 2.0 px, above the floor.
    expect(resolveLineWeightPx(50, undefined)).toBeCloseTo(2.0);
    // 100 (= 1.00 mm) → 4.0 px, the heavy callout band.
    expect(resolveLineWeightPx(100, undefined)).toBeCloseTo(4.0);
  });

  it('falls through to the layer weight on ByLayer / undefined', () => {
    // Entity = ByLayer (-1) → use layer weight.
    expect(resolveLineWeightPx(-1, 50)).toBeCloseTo(2.0);
    // Entity has no weight at all → use layer weight.
    expect(resolveLineWeightPx(undefined, 100)).toBeCloseTo(4.0);
  });

  it('falls through ByBlock (-2) the same as ByLayer', () => {
    expect(resolveLineWeightPx(-2, 50)).toBeCloseTo(2.0);
  });

  it('returns the default px width on LWDEFAULT (-3) with no layer override', () => {
    // 1.5 px is the documented default (matches the spec's "use 1.5 px until
    // the user picks something").
    expect(resolveLineWeightPx(-3, undefined)).toBeCloseTo(1.5);
    // No info anywhere → still default.
    expect(resolveLineWeightPx(undefined, undefined)).toBeCloseTo(1.5);
  });

  it('clamps below 1 px to keep thin strokes legible', () => {
    // 5 (= 0.05 mm) would map to 0.2 px raw; clamp to 1 px.
    expect(resolveLineWeightPx(5, undefined)).toBeCloseTo(1.0);
  });
});

describe('buildScene — Line2 promotion', () => {
  // Minimal valid DxfDocument: two lines on different weights, plus the
  // default layer "0". The doc shape is the parser's output contract; we
  // hand-build it to avoid touching the parser internals.
  const doc: DxfDocument = {
    bounds: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
    insUnits: 4,
    layers: [{ name: '0', color: 7, frozen: false }],
    entities: [
      {
        kind: 'line',
        layer: '0',
        color: 7,
        p1: { x: 0, y: 0 },
        p2: { x: 10, y: 0 },
        // 0.50 mm → 2.0 px bucket.
        lineWeight: 50,
      },
      {
        kind: 'line',
        layer: '0',
        color: 7,
        p1: { x: 0, y: 5 },
        p2: { x: 10, y: 5 },
        // 1.00 mm → 4.0 px bucket; should NOT merge with the 2 px bucket.
        lineWeight: 100,
      },
      {
        kind: 'circle',
        layer: '0',
        color: 7,
        center: { x: 5, y: 5 },
        radius: 2,
        // No lineWeight → default 1.5 px.
      },
    ],
    unsupportedKinds: [],
  };

  it('emits one LineMaterial instance per (layer × kind × line-weight) bucket', () => {
    const built = buildScene(doc);
    try {
      // Three buckets: (0, lines, 2.0), (0, lines, 4.0), (0, curves, 1.5).
      expect(built.lineMaterials).toHaveLength(3);
      for (const m of built.lineMaterials) {
        expect(m).toBeInstanceOf(LineMaterial);
      }
    } finally {
      built.dispose();
    }
  });

  it('LineMaterial.linewidth reflects the resolved px width per bucket', () => {
    const built = buildScene(doc);
    try {
      const widths = built.lineMaterials
        .map((m) => (m as LineMaterial & { linewidth: number }).linewidth)
        .sort((a, b) => a - b);
      // Sorted ascending: curves (1.5), thin line (2.0), heavy line (4.0).
      expect(widths[0]).toBeCloseTo(1.5);
      expect(widths[1]).toBeCloseTo(2.0);
      expect(widths[2]).toBeCloseTo(4.0);
    } finally {
      built.dispose();
    }
  });

  it('setResolution propagates the canvas size into every LineMaterial', () => {
    const built = buildScene(doc);
    try {
      built.setResolution(1920, 1080);
      for (const m of built.lineMaterials) {
        expect(m.resolution.x).toBe(1920);
        expect(m.resolution.y).toBe(1080);
      }
      // Re-sets cleanly.
      built.setResolution(800, 600);
      for (const m of built.lineMaterials) {
        expect(m.resolution.x).toBe(800);
        expect(m.resolution.y).toBe(600);
      }
    } finally {
      built.dispose();
    }
  });

  it('setResolution ignores zero / NaN values rather than corrupting the uniform', () => {
    const built = buildScene(doc);
    try {
      built.setResolution(1024, 768);
      // Each of these should be a no-op (the previous valid resolution
      // stays in place).
      built.setResolution(0, 0);
      built.setResolution(Number.NaN, 768);
      for (const m of built.lineMaterials) {
        expect(m.resolution.x).toBe(1024);
        expect(m.resolution.y).toBe(768);
      }
    } finally {
      built.dispose();
    }
  });

  it('falls back to the layer-default lineWeight when entities are ByLayer', () => {
    const docByLayer: DxfDocument = {
      bounds: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
      insUnits: 4,
      layers: [
        // Layer "HEAVY" defaults to 1.00 mm (group 370 = 100 → 4 px).
        { name: 'HEAVY', color: 7, frozen: false, lineWeight: 100 },
      ],
      entities: [
        {
          kind: 'line',
          layer: 'HEAVY',
          color: 256, // ByLayer
          p1: { x: 0, y: 0 },
          p2: { x: 10, y: 0 },
          lineWeight: -1, // explicit ByLayer; behaves the same as undefined
        },
      ],
      unsupportedKinds: [],
    };
    const built = buildScene(docByLayer);
    try {
      expect(built.lineMaterials).toHaveLength(1);
      const mat = built.lineMaterials[0]! as LineMaterial & {
        linewidth: number;
      };
      expect(mat.linewidth).toBeCloseTo(4.0);
    } finally {
      built.dispose();
    }
  });
});
