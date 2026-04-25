/**
 * Pure geometry helpers for the viewer's measurement tool.
 *
 * All inputs/outputs are unit-agnostic — the caller is responsible for picking
 * the right native space (DXF world units or PDF page units) and labeling the
 * result with the matching unit string. {@link formatLength} / {@link formatArea}
 * are presentation-only.
 */

import type { Point2D } from './types';

/** Euclidean distance between two points (same units in, same units out). */
export function distance(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.hypot(dx, dy);
}

/**
 * Total length of an open polyline. Returns 0 for fewer than 2 points.
 */
export function polylineLength(points: Point2D[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1]!, points[i]!);
  }
  return total;
}

/**
 * Polygon perimeter — closes the ring (last → first). Returns 0 for <3 points.
 */
export function polygonPerimeter(points: Point2D[]): number {
  if (points.length < 3) return 0;
  let total = polylineLength(points);
  total += distance(points[points.length - 1]!, points[0]!);
  return total;
}

/**
 * Polygon area via the Shoelace formula.
 *
 * Returns the absolute area (sign of the result depends on winding); we don't
 * care about orientation for measurement display.
 */
export function polygonArea(points: Point2D[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Centroid (used to position labels). */
export function centroid(points: Point2D[]): Point2D {
  if (points.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/** Midpoint of a segment. */
export function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Format a length value with thousand separators and unit suffix.
 *
 * - mm: 0 fractional digits if abs ≥ 100, otherwise 2.
 * - other: 2 fractional digits.
 *
 * @example
 *   formatLength(1234.5)       // "1,235 mm"
 *   formatLength(12.34, 'mm')  // "12.34 mm"
 *   formatLength(72, 'pt')     // "72.00 pt"
 */
export function formatLength(value: number, unit: string = 'mm'): string {
  const abs = Math.abs(value);
  const digits = unit === 'mm' ? (abs >= 100 ? 0 : 2) : 2;
  return `${formatNumber(value, digits)} ${unit}`;
}

/**
 * Format an area value. Always 2 decimal places for sub-unit precision; when
 * the magnitude is large (>= 1,000,000 mm² = 1 m²), prefer m² for legibility.
 */
export function formatArea(value: number, unit: string = 'mm'): string {
  if (unit === 'mm' && Math.abs(value) >= 1_000_000) {
    return `${formatNumber(value / 1_000_000, 3)} m²`;
  }
  const digits = unit === 'mm' ? (Math.abs(value) >= 100 ? 0 : 2) : 2;
  return `${formatNumber(value, digits)} ${unit}²`;
}

function formatNumber(value: number, digits: number): string {
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Map DXF $INSUNITS code → unit label and a multiplier to mm.
 *
 * Reference: AutoCAD Header Variables — INSUNITS.
 *   0 = Unitless, 1 = Inches, 2 = Feet, 4 = Millimeters, 5 = Centimeters,
 *   6 = Meters, 21 = Decimeters, ...
 *
 * Defaults to mm with multiplier 1 when unit is unknown / unitless.
 */
export function dxfUnitFromInsunits(code: number | undefined): {
  unit: string;
  toMm: number;
} {
  switch (code) {
    case 1:
      return { unit: 'in', toMm: 25.4 };
    case 2:
      return { unit: 'ft', toMm: 304.8 };
    case 4:
      return { unit: 'mm', toMm: 1 };
    case 5:
      return { unit: 'cm', toMm: 10 };
    case 6:
      return { unit: 'm', toMm: 1000 };
    case 21:
      return { unit: 'dm', toMm: 100 };
    default:
      return { unit: 'mm', toMm: 1 };
  }
}
