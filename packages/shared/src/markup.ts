// Shared schemas for the R-MARKUP / V-6 measurement markup feature.
//
// Why these live in `packages/shared`:
//   - The FE Zustand store and the BE Prisma layer both need to agree on
//     the exact shape of a saved measurement set. Drifting copies in two
//     places is the kind of bug that only shows up after a refresh.
//   - The viewer types in `apps/web/lib/viewer/types.ts` already define
//     `Measurement` / `WorldPoint` for in-memory use. Those stay as the
//     authoring source; this file mirrors them as runtime-validated
//     zod schemas so anything that crosses the network is parsed and
//     guarded the same way on both ends.
//
// Caps:
//   - measurements: ≤ 500 rows per markup
//   - points per measurement: ≤ 200
//   - additional 256KB serialized payload guard is enforced by the
//     route handler (zod can't see post-encoding size cheaply).
// These caps are intentionally generous for normal workflows and tight
// enough to keep a single Markup row well under JSONB's healthy size.

import { z } from 'zod';

// ── Coordinate primitives ─────────────────────────────────────────────────

export const Point2DSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type Point2D = z.infer<typeof Point2DSchema>;

/**
 * A 2D point in either PDF page space or DXF world space, tagged with a
 * discriminator so callers can never confuse the two. Mirrors
 * `WorldPoint` in `apps/web/lib/viewer/types.ts`.
 */
export const WorldPointSchema = Point2DSchema.extend({
  space: z.enum(['pdf-page', 'dxf-world']),
  /** PDF only: 1-based page number this point lives on. */
  page: z.number().int().positive().optional(),
});
export type WorldPoint = z.infer<typeof WorldPointSchema>;

// ── Measurement ───────────────────────────────────────────────────────────

export const MeasurementKindSchema = z.enum(['distance', 'polyline', 'area']);
export type MeasurementKind = z.infer<typeof MeasurementKindSchema>;

/**
 * A single persisted measurement. Coordinates are stored in their native
 * space (DXF model units / PDF page units) so zoom and pan never
 * invalidate the computed `value`.
 *
 * The runtime schema accepts ≥2 points (distance/polyline). Area
 * geometrically needs ≥3 points but we still allow 2 here to keep parser
 * tolerance for half-formed rows produced by client crashes; the FE
 * computes the geometric value and discards bad data on load if needed.
 */
export const MeasurementSchema = z.object({
  id: z.string().min(1).max(64),
  kind: MeasurementKindSchema,
  points: z.array(WorldPointSchema).min(2).max(200),
  /**
   * Primary computed value in display units (mm).
   *  - distance / polyline → total length
   *  - area                → surface area
   */
  value: z.number().finite(),
  /** Secondary value (e.g. perimeter for area, or undefined). */
  perimeter: z.number().finite().optional(),
  /** Display unit suffix (e.g. 'mm', 'mm²', 'pt'). */
  unitLabel: z.string().min(1).max(16),
  /** ms epoch — preserved across save/load so list ordering stays. */
  createdAt: z.number().int(),
});
export type Measurement = z.infer<typeof MeasurementSchema>;

// ── Markup payload (the JSONB column) ────────────────────────────────────

/**
 * `MarkupPayload` is exactly what gets serialized into `Markup.payload`.
 * `schemaVersion: 1` is the future-compat marker — once the FE/BE need
 * a v2 shape, both sides switch on this literal.
 */
export const MarkupPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  /** Whether the markup was authored on top of a PDF or a DXF. */
  mode: z.enum(['pdf', 'dxf']),
  /** Display unit at save time (e.g. 'mm', 'pt'). */
  unitLabel: z.string().min(1).max(16),
  /** Per-markup cap. The route handler also enforces total size ≤ 256KB. */
  measurements: z.array(MeasurementSchema).max(500),
});
export type MarkupPayload = z.infer<typeof MarkupPayloadSchema>;

// ── API DTOs ─────────────────────────────────────────────────────────────

/**
 * The compact list-view shape returned by GET. We deliberately leave the
 * full payload out of the list response so a heavily-annotated attachment
 * does not balloon the request — call PATCH/load to fetch the payload of
 * a specific row.
 */
export const MarkupRowSchema = z.object({
  id: z.string(),
  attachmentId: z.string(),
  ownerId: z.string(),
  /** Joined from the User row at query time (BE adds this). */
  ownerName: z.string(),
  name: z.string().min(1).max(200),
  isShared: z.boolean(),
  /** payload.measurements.length — server-derived for cheap counters. */
  measurementCount: z.number().int().nonnegative(),
  /** payload.mode — surfaced for the UI 'PDF / DXF' badge. */
  mode: z.enum(['pdf', 'dxf']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MarkupRow = z.infer<typeof MarkupRowSchema>;

/**
 * The full row including payload — returned by POST/PATCH and (in a
 * future polish round) by GET ?include=payload. The FE uses this when
 * the user clicks "불러오기" on a saved markup.
 */
export const MarkupDetailSchema = MarkupRowSchema.extend({
  payload: MarkupPayloadSchema,
});
export type MarkupDetail = z.infer<typeof MarkupDetailSchema>;

/** Wire shape for POST /api/v1/attachments/{id}/markups. */
export const CreateMarkupBodySchema = z.object({
  name: z.string().min(1).max(200),
  isShared: z.boolean().default(false),
  payload: MarkupPayloadSchema,
});
export type CreateMarkupBody = z.infer<typeof CreateMarkupBodySchema>;

/**
 * Wire shape for PATCH /api/v1/markups/{markupId}. Every field is
 * optional but at least one must be provided — the route handler
 * enforces "≥1 field" because zod's optional-only object would
 * silently accept an empty body.
 */
export const UpdateMarkupBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isShared: z.boolean().optional(),
  payload: MarkupPayloadSchema.optional(),
});
export type UpdateMarkupBody = z.infer<typeof UpdateMarkupBodySchema>;

/** Response envelope for GET list — `mine` vs `shared` split. */
export const MarkupListResponseSchema = z.object({
  attachmentId: z.string(),
  mine: z.array(MarkupRowSchema),
  shared: z.array(MarkupRowSchema),
});
export type MarkupListResponse = z.infer<typeof MarkupListResponseSchema>;
