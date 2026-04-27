import { describe, it, expect } from 'vitest';

import { clipSegmentToHatch } from '@/components/DwgViewer/scene';

// Geometry helpers for test readability.
type Pt = { x: number; y: number };
const sq = (cx: number, cy: number, h: number): Pt[] => [
  { x: cx - h, y: cy - h },
  { x: cx + h, y: cy - h },
  { x: cx + h, y: cy + h },
  { x: cx - h, y: cy + h },
];

// A 10x10 unit square centred at origin (so the area is x∈[-5,5], y∈[-5,5]).
const OUTER = sq(0, 0, 5);
// A 2x2 hole centred at origin (so the donut area is everything in OUTER but
// not in HOLE).
const HOLE = sq(0, 0, 1);

describe('clipSegmentToHatch', () => {
  it('returns the full segment when both endpoints are strictly inside', () => {
    // Horizontal segment from (-3, 2) → (3, 2) is well inside the outer
    // square and above the hole.
    const segs = clipSegmentToHatch(-3, 2, 3, 2, [OUTER]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.ax).toBeCloseTo(-3);
    expect(segs[0]!.ay).toBeCloseTo(2);
    expect(segs[0]!.bx).toBeCloseTo(3);
    expect(segs[0]!.by).toBeCloseTo(2);
  });

  it('returns empty when the segment is entirely outside the outer ring', () => {
    // Segment far above the square.
    const segs = clipSegmentToHatch(-10, 20, 10, 20, [OUTER]);
    expect(segs).toEqual([]);
  });

  it('clips a segment that crosses one boundary edge (half inside)', () => {
    // From outside (-10, 0) to inside (0, 0). Should cut at x = -5.
    const segs = clipSegmentToHatch(-10, 0, 0, 0, [OUTER]);
    expect(segs).toHaveLength(1);
    const s = segs[0]!;
    expect(s.ax).toBeCloseTo(-5);
    expect(s.ay).toBeCloseTo(0);
    expect(s.bx).toBeCloseTo(0);
    expect(s.by).toBeCloseTo(0);
  });

  it('skips the hole — produces two sub-segments for a chord crossing it', () => {
    // Horizontal chord from (-4, 0) → (4, 0). The hole spans x∈[-1,1] at y=0,
    // so the chord should be split into [-4..-1] and [1..4].
    const segs = clipSegmentToHatch(-4, 0, 4, 0, [OUTER, HOLE]);
    expect(segs).toHaveLength(2);
    // Segments are returned in t-order along the original direction (a→b),
    // so the first one is the left arm.
    const left = segs[0]!;
    const right = segs[1]!;
    expect(left.ax).toBeCloseTo(-4);
    expect(left.bx).toBeCloseTo(-1);
    expect(right.ax).toBeCloseTo(1);
    expect(right.bx).toBeCloseTo(4);
  });

  it('returns empty when the segment is entirely inside a hole', () => {
    // Segment fully inside HOLE — outside the hatched (donut) area.
    const segs = clipSegmentToHatch(-0.5, 0, 0.5, 0, [OUTER, HOLE]);
    expect(segs).toEqual([]);
  });

  it('handles a segment whose endpoint lies exactly on the boundary edge', () => {
    // Endpoint exactly on the right edge x=5 — should still produce a single
    // in-polygon sub-segment ending at the boundary.
    const segs = clipSegmentToHatch(0, 0, 5, 0, [OUTER]);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    // Last sub-segment should reach x≈5.
    const last = segs[segs.length - 1]!;
    expect(last.bx).toBeCloseTo(5);
    // First sub-segment should start at the input start.
    expect(segs[0]!.ax).toBeCloseTo(0);
  });

  it('returns empty for zero-length segments (degenerate input)', () => {
    const segs = clipSegmentToHatch(1, 1, 1, 1, [OUTER]);
    expect(segs).toEqual([]);
  });

  it('returns empty when no loops are supplied', () => {
    const segs = clipSegmentToHatch(0, 0, 1, 1, []);
    expect(segs).toEqual([]);
  });
});
