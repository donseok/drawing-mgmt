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
 * R12 — solid HATCH only (pattern hatches degrade to outline). Each loop is
 * an ordered ring of points; the first loop is the outer boundary, subsequent
 * loops are holes. Three.Shape consumes this layout directly.
 */
export interface HatchEntity extends EntityBase {
  kind: 'hatch';
  loops: V2[][];
  solid: boolean;
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
