/**
 * Viewer types — shared across PDF/DXF engines and UI.
 *
 * Coordinate spaces:
 *  - **screen** — pixels relative to the canvas/SVG container (CSS px). Used by
 *    pointer events.
 *  - **page** (PDF only) — PDF page user units (72 dpi). Stored at scale=1.
 *  - **world** (DXF only) — DXF model units (mm by default; respect $INSUNITS).
 *
 * MeasurementOverlay always converts incoming clicks into the appropriate
 * native space and persists in that space, so zoom/pan never invalidates a
 * measurement's value.
 */

export type ViewerMode = 'pdf' | 'dxf';

/** Active interactive tool on the canvas. */
export type ToolMode =
  | 'pan'
  | 'measure-distance'
  | 'measure-polyline'
  | 'measure-area';

/** Sidebar tab identifiers. */
export type SidebarTab = 'layers' | 'pages' | 'measurements' | 'properties';

/** A 2D point in some coordinate space (defined by context). */
export interface Point2D {
  x: number;
  y: number;
}

/** Branded world point — explicit when a value is in DXF/PDF native units. */
export interface WorldPoint extends Point2D {
  /** Discriminator: which native space these coords belong to. */
  space: 'pdf-page' | 'dxf-world';
  /** PDF only: 1-based page number this point lives on. */
  page?: number;
}

export type MeasurementKind = 'distance' | 'polyline' | 'area';

/** A persisted measurement (lives in viewer state). */
export interface Measurement {
  id: string;
  kind: MeasurementKind;
  /** Points in native space. ≥2 for distance, ≥2 for polyline, ≥3 for area. */
  points: WorldPoint[];
  /**
   * Computed primary value, in display units (mm).
   *  - distance / polyline: total length
   *  - area: surface area
   */
  value: number;
  /** Secondary value (e.g. perimeter for area, or undefined). */
  perimeter?: number;
  /** Display unit suffix (e.g. 'mm', 'mm²', 'pt'). */
  unitLabel: string;
  createdAt: number;
}

/** Layer info exposed by dxf-viewer (subset). */
export interface LayerInfo {
  name: string;
  displayName: string;
  /** 24-bit RGB color from the DXF (0xRRGGBB) — best effort. */
  color?: number;
  /** Hex CSS color string (e.g. `#ff8800`). */
  colorHex?: string;
  /** Frozen / locked / off in DXF spec. */
  frozen?: boolean;
  visible: boolean;
}

/** Snapshot of viewer state used for persistence/debug. */
export interface ViewerState {
  mode: ViewerMode;
  tool: ToolMode;
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  page: number;
  pageCount: number;
  invertBackground: boolean;
  showLineWeight: boolean;
  fullscreen: boolean;
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
}

/** Attachment metadata returned from /api/v1/attachments/[id]/meta. */
export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  isMaster: boolean;
  conversionStatus: 'pending' | 'running' | 'success' | 'failed';
  hasPdf: boolean;
  hasDxf: boolean;
  hasThumbnail: boolean;
  /** Owning object (자료) id. */
  objectId: string;
  /** 도면번호. */
  objectNumber: string;
  /** 자료명. */
  objectName: string;
}
