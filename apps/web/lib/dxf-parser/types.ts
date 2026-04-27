// Phase 1 entity tree shape — kept intentionally narrow so the parser, the
// scene builder, and any future serialization layer all agree on one schema.
//
// All coordinates are in DXF model units (typically mm — see HEADER $INSUNITS).
// Z is omitted from V2 because Phase 1 is 2D-only; full 3D coords arrive when
// PerspectiveCamera / Z-aware tools land in a later phase.

export interface V2 {
  x: number;
  y: number;
}

interface EntityBase {
  /** DXF layer name. Empty string maps to layer "0". */
  layer: string;
  /** AutoCAD Color Index. 256 = ByLayer, 0 = ByBlock. */
  color: number;
  /**
   * R37 V-2 — DXF group code 370 (LineWeight) value.
   *
   * Encoding follows the DXF spec:
   *   - `-1` = ByLayer (resolve from layer's lineWeight)
   *   - `-2` = ByBlock
   *   - `-3` = LWDEFAULT (use the document default, currently treated as
   *     ByLayer)
   *   - any other non-negative integer = thickness in **1/100 mm**
   *     (e.g. `13` ≡ 0.13 mm, `50` ≡ 0.50 mm, `211` ≡ 2.11 mm)
   *
   * Optional because pre-R37 DXFs the parser saw without group 370 still
   * round-trip — the scene builder falls back to a sensible default px width.
   */
  lineWeight?: number;
}

export interface LineEntity extends EntityBase {
  kind: 'line';
  p1: V2;
  p2: V2;
}

export interface CircleEntity extends EntityBase {
  kind: 'circle';
  center: V2;
  radius: number;
}

export interface ArcEntity extends EntityBase {
  kind: 'arc';
  center: V2;
  radius: number;
  /** Degrees. DXF arcs are always counter-clockwise from startAngle to endAngle. */
  startAngle: number;
  endAngle: number;
}

export interface PolylineEntity extends EntityBase {
  kind: 'polyline';
  points: V2[];
  closed: boolean;
}

/**
 * R10 Phase 2 — TEXT and MTEXT collapse into a single render shape because
 * the scene builder treats them identically (canvas-texture sprite anchored at
 * `position`). `rotation` is in degrees, CCW from +X. MTEXT inline codes
 * (\\P newline, \\f font) are stripped to plain text in this phase; full
 * inline rendering is a future enhancement.
 */
export interface TextEntity extends EntityBase {
  kind: 'text';
  position: V2;
  /** Cap height in DXF model units. */
  height: number;
  rotation: number;
  content: string;
  /** Horizontal alignment. 0=left (default), 1=center, 2=right. */
  hAlign: 0 | 1 | 2;
}

/**
 * R12 — solid HATCH consumed via three.Shape. Each loop is an ordered ring of
 * points; the first loop is the outer boundary, subsequent loops are holes.
 *
 * R25 — pattern HATCH metadata. When `solid === false`, the scene builder
 * uses `patternName` to pick a hatch line set (ANSI31 / ANSI32 / DOTS), then
 * crosshatches inside the boundary at `patternAngle` (degrees, base offset)
 * with line spacing scaled by `patternScale`. Fields are optional because
 * pre-R25 DXFs that the parser saw without pattern data still parse.
 */
export interface HatchEntity extends EntityBase {
  kind: 'hatch';
  loops: V2[][];
  solid: boolean;
  /** Pattern name from group 2 (e.g. "ANSI31", "ANSI32", "DOTS", "SOLID"). */
  patternName?: string;
  /** Pattern angle in degrees from group 52. Defaults to 0 when absent. */
  patternAngle?: number;
  /** Pattern scale from group 41. Defaults to 1 when absent or zero. */
  patternScale?: number;
}

export type DxfEntity =
  | LineEntity
  | CircleEntity
  | ArcEntity
  | PolylineEntity
  | TextEntity
  | HatchEntity;

export interface DxfLayerInfo {
  name: string;
  color: number;
  /** True when DXF flag bit 1 is set (layer frozen / hidden). */
  frozen: boolean;
  /**
   * Layer-default line weight (DXF group 370 on the LAYER record). Same
   * encoding as `EntityBase.lineWeight` — `-3` (LWDEFAULT) is the most
   * common value here. Optional so older files / test fixtures without the
   * record still type-check.
   */
  lineWeight?: number;
}

export interface DxfDocument {
  /**
   * Bounding box derived either from $EXTMIN/$EXTMAX in the HEADER or, when
   * those are absent / zero, computed from entity geometry. Always present so
   * the camera fit code never has to special-case empty docs.
   */
  bounds: {
    min: V2;
    max: V2;
  };
  /**
   * 1=inch, 2=ft, 4=mm, 5=cm, 6=m. 0 = unitless. Default to 4 (mm) when
   * absent — most CAD files we ingest are mm.
   */
  insUnits: number;
  layers: DxfLayerInfo[];
  entities: DxfEntity[];
  /** Tags the parser saw but didn't recognize. Useful for telemetry. */
  unsupportedKinds: string[];
}
