// Unit tests for MarkupPayloadSchema. We exercise the runtime contract
// rather than route plumbing — happy path + the three failure modes
// most likely to come back from the FE during development.

import { describe, expect, it } from 'vitest';
import {
  MarkupPayloadSchema,
  type MarkupPayload,
} from '@drawing-mgmt/shared/markup';

const validMeasurement = {
  id: 'm1',
  kind: 'distance' as const,
  points: [
    { x: 0, y: 0, space: 'pdf-page' as const, page: 1 },
    { x: 100, y: 0, space: 'pdf-page' as const, page: 1 },
  ],
  value: 100,
  unitLabel: 'mm',
  createdAt: 1714530000000,
};

describe('MarkupPayloadSchema', () => {
  it('accepts a minimal valid payload (single measurement, PDF mode)', () => {
    const input: MarkupPayload = {
      schemaVersion: 1,
      mode: 'pdf',
      unitLabel: 'mm',
      measurements: [validMeasurement],
    };
    const parsed = MarkupPayloadSchema.parse(input);
    expect(parsed.measurements).toHaveLength(1);
    expect(parsed.mode).toBe('pdf');
  });

  it('accepts an empty measurements array (zero is below the cap)', () => {
    // Important: a markup with zero measurements is unusual (the FE
    // disables save until ≥1) but the schema must not crash on it —
    // listing endpoints rely on payload.measurements.length and that
    // path needs to handle 0 cleanly.
    const parsed = MarkupPayloadSchema.parse({
      schemaVersion: 1,
      mode: 'dxf',
      unitLabel: 'mm',
      measurements: [],
    });
    expect(parsed.measurements).toHaveLength(0);
  });

  it('rejects an unknown mode value', () => {
    const result = MarkupPayloadSchema.safeParse({
      schemaVersion: 1,
      mode: 'svg', // not a member of ['pdf', 'dxf']
      unitLabel: 'mm',
      measurements: [validMeasurement],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = result.error.flatten();
      // The mode field error is path-aware; we just confirm zod
      // surfaced the issue rather than silently coercing.
      expect(JSON.stringify(flat.fieldErrors)).toContain('mode');
    }
  });

  it('rejects more than 500 measurements (cap)', () => {
    const measurements = Array.from({ length: 501 }, (_, i) => ({
      ...validMeasurement,
      id: `m-${i}`,
    }));
    const result = MarkupPayloadSchema.safeParse({
      schemaVersion: 1,
      mode: 'pdf',
      unitLabel: 'mm',
      measurements,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // The error message includes "500" because zod's max() preset
      // refers to the configured boundary. We grep loosely so a future
      // wording change in zod doesn't trigger a false negative.
      expect(JSON.stringify(result.error.format())).toMatch(/500|max/i);
    }
  });

  it('rejects more than 200 points in a single measurement', () => {
    const tooManyPoints = Array.from({ length: 201 }, (_, i) => ({
      x: i,
      y: 0,
      space: 'pdf-page' as const,
      page: 1,
    }));
    const result = MarkupPayloadSchema.safeParse({
      schemaVersion: 1,
      mode: 'pdf',
      unitLabel: 'mm',
      measurements: [{ ...validMeasurement, points: tooManyPoints }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects schemaVersion other than 1', () => {
    // Future-proofing: the literal 1 means the FE/BE both lock onto
    // the v1 shape until a deliberate migration. A v2 payload coming
    // back from a stale tab must fail loud.
    const result = MarkupPayloadSchema.safeParse({
      schemaVersion: 2,
      mode: 'pdf',
      unitLabel: 'mm',
      measurements: [validMeasurement],
    });
    expect(result.success).toBe(false);
  });
});
