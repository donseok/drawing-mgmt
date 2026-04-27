// DXF entity tree → three.js scene builder.
//
// Phase 1 strategy: one BufferGeometry per (layer × geometry kind × line
// weight) bucket. "Per layer" lets us toggle visibility cheaply via
// Group.visible. "Per kind" keeps line- vs arc-segment math separate so a
// single draw call can render thousands of LINEs without per-entity object
// overhead. "Per line weight" (R37 V-2) is required because LineMaterial
// carries a single `linewidth`; lines with different widths can't share a
// material without losing the width. Curved entities (arc, circle) are
// tessellated to LINE_SEGMENTS_PER_REVOLUTION.
//
// R37 V-2 — line strokes are drawn with `LineSegments2` + `LineMaterial`
// (three.js examples/jsm/lines, MIT). LineMaterial implements wide lines as
// instanced quads in a screen-space shader, which the stock WebGL `LINES`
// primitive can't do (1px on every desktop GPU). The trade-off is a Vector2
// `resolution` uniform that we keep in sync with the canvas size — the
// builder exposes `setResolution(w, h)` for the React layer to call inside
// the existing ResizeObserver.
//
// What we explicitly DON'T do here:
//   - LOD / per-frame retessellation. Phase 1 picks a single segment count
//     and lives with it. LOD comes back when zoom-aware rendering ships.
//   - Promote HATCH pattern fills to Line2: pattern lines are typically very
//     dense and the visual noise from 1.5–2 px strokes dominates the scene.
//     We deliberately keep them on `LineBasicMaterial` (1px) — it's correct,
//     fast, and matches AutoCAD's pattern rendering.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import {
  type ArcEntity,
  type CircleEntity,
  type DxfDocument,
  type DxfEntity,
  type DxfLayerInfo,
  type HatchEntity,
  type LineEntity,
  type PolylineEntity,
  type TextEntity,
  type V2,
  aciToRgb,
  DEFAULT_FOREGROUND,
} from '@/lib/dxf-parser';

/** Tessellation density for curved primitives. 64 segments per full circle is
 *  visually round at typical viewport sizes without exploding the vertex count
 *  on industrial drawings (which routinely contain thousands of holes). */
const SEGMENTS_PER_REVOLUTION = 64;

/**
 * R37 V-2 — line-weight conversion from DXF (1/100 mm) to CSS pixels.
 *
 * Anchors picked from R37 spec:
 *   - 0.13 mm → 0.5 px  (thin construction lines)
 *   - 0.50 mm → 2.0 px  (standard outline)
 *   - 1.00 mm → 4.0 px  (heavy callouts)
 *
 * The relationship is linear at `px = 4 × mm`, then floored at 1.0 so even
 * the thinnest lines stay legible — pre-clamp 0.5 px sub-pixels look faded
 * on a HiDPI display because the alpha-coverage shader can't bias toward
 * either side of the line. 1 px is also the floor for stock browser stroke
 * antialiasing so it matches user expectations from PDF/print viewers.
 */
const MM_TO_PX = 4;
/** Default px width when a line has no DXF line-weight (or `-3` LWDEFAULT). */
const DEFAULT_LINEWEIGHT_PX = 1.5;
/** Floor so very thin DXF weights still render visibly on screen. */
const MIN_LINEWEIGHT_PX = 1.0;
/** Initial value for the LineMaterial.resolution Vector2. The DwgViewer
 *  React component overwrites this immediately via setResolution(); the
 *  default keeps SSR / unit tests from dividing by zero. */
const DEFAULT_RESOLUTION_W = 1024;
const DEFAULT_RESOLUTION_H = 768;

/**
 * Resolve an entity's lineWeight against the layer-default. Returns CSS px.
 *
 * @param entityWeight  raw value of `EntityBase.lineWeight` or `undefined`
 * @param layerWeight   raw value of the entity's layer's `lineWeight`,
 *                       or `undefined`
 *
 * Order of precedence:
 *   1. Entity overrides: any `>= 0` value wins outright.
 *   2. ByLayer (`-1`, undefined): fall through to the layer's own weight.
 *   3. ByBlock (`-2`): same as ByLayer for our purposes (INSERT expansion
 *      already collapsed the block context into the entity's resolved
 *      colour/layer; we treat ByBlock as ByLayer at this point).
 *   4. LWDEFAULT (`-3`) or no information at all → DEFAULT_LINEWEIGHT_PX.
 */
export function resolveLineWeightPx(
  entityWeight: number | undefined,
  layerWeight: number | undefined,
): number {
  if (typeof entityWeight === 'number' && entityWeight >= 0) {
    return Math.max(MIN_LINEWEIGHT_PX, (entityWeight / 100) * MM_TO_PX);
  }
  // Entity says ByLayer / ByBlock / LWDEFAULT / nothing — try the layer.
  if (typeof layerWeight === 'number' && layerWeight >= 0) {
    return Math.max(MIN_LINEWEIGHT_PX, (layerWeight / 100) * MM_TO_PX);
  }
  return DEFAULT_LINEWEIGHT_PX;
}

export interface SceneLayer {
  name: string;
  /** Layer color resolved to 0xRRGGBB (used when entities are ByLayer). */
  color: number;
  /** Three.js Group whose `visible` toggles every entity on the layer. */
  group: THREE.Group;
  /** Frozen-in-DXF layers default to invisible — surfaced so the UI can
   *  reflect the initial state in the layer panel. */
  initiallyVisible: boolean;
}

export interface BuiltScene {
  scene: THREE.Scene;
  layers: SceneLayer[];
  /**
   * R37 V-2 — every `LineMaterial` instance the builder created. The React
   * shell uses this list to push the canvas resolution into each material's
   * `resolution` uniform inside its ResizeObserver. Exposed (rather than
   * giving callers a setter) so tests can directly verify the materials
   * exist with the expected linewidths without spinning up a renderer.
   */
  lineMaterials: LineMaterial[];
  /**
   * Update every owned LineMaterial's `resolution` uniform. Pass the canvas
   * size in CSS pixels — three.js multiplies internally by the device pixel
   * ratio when the renderer's setPixelRatio() has been configured.
   */
  setResolution: (widthPx: number, heightPx: number) => void;
  /** All disposable geometries / materials owned by this build. The React
   *  component calls `dispose()` to release GPU resources on unmount or when
   *  swapping the source DXF. */
  dispose: () => void;
}

/**
 * Build a Three.js scene from a parsed DXF document. Pure with respect to the
 * input — no DOM access, no fetches.
 */
export function buildScene(doc: DxfDocument): BuiltScene {
  const scene = new THREE.Scene();
  // Transparent clear so the host canvas controls background color. The dxf
  // viewer page uses white today; dark mode would just flip the host.
  scene.background = null;

  // Index layers so per-entity color lookup is O(1).
  const layersByName = new Map<string, DxfLayerInfo>();
  for (const l of doc.layers) layersByName.set(l.name, l);

  // Bucket entities by (layer, kind, line weight) — separate buckets for
  // lines vs curve segments so each gets its own draw call, and one bucket
  // per resolved lineweight so a single LineMaterial can render the whole
  // batch (LineMaterial.linewidth is per-material, not per-vertex).
  //
  // Quantising the px width to 2 decimal places keeps the bucket count
  // bounded even when the input has many slightly-different DXF weights —
  // e.g. 0.13 mm vs 0.15 mm differ by 0.08 px and merge into the same
  // bucket, which the eye can't distinguish anyway.
  type BucketKey = string; // `${layer}::${'lines'|'curves'}::${pxKey}`
  interface Bucket {
    layer: string;
    color: number;
    lineWeightPx: number;
    /** Flat XY pairs ready to be packed into a Float32Array. */
    positions: number[];
  }
  const buckets = new Map<BucketKey, Bucket>();
  const layerNames = new Set<string>();
  // R10 Phase 2 — text entities are rendered per-instance (canvas texture
  // sprites) instead of bucketed; collect them here and emit individual
  // meshes during the layer pass below.
  const textsByLayer = new Map<string, TextEntity[]>();
  // R12 Phase 4 — hatch entities are tessellated to triangle meshes via
  // THREE.ShapeGeometry. Like text, each one becomes its own mesh.
  const hatchesByLayer = new Map<string, HatchEntity[]>();

  const getBucket = (
    layer: string,
    kind: 'lines' | 'curves',
    color: number,
    lineWeightPx: number,
  ) => {
    layerNames.add(layer);
    // Quantise to 2 decimals so 1.000001 vs 1.000002 don't fragment the
    // bucket map.
    const pxKey = lineWeightPx.toFixed(2);
    const key: BucketKey = `${layer}::${kind}::${pxKey}`;
    const existing = buckets.get(key);
    if (existing) return existing;
    const next: Bucket = { layer, color, lineWeightPx, positions: [] };
    buckets.set(key, next);
    return next;
  };

  const addText = (text: TextEntity) => {
    layerNames.add(text.layer);
    const list = textsByLayer.get(text.layer) ?? [];
    list.push(text);
    textsByLayer.set(text.layer, list);
  };

  const addHatch = (hatch: HatchEntity) => {
    layerNames.add(hatch.layer);
    const list = hatchesByLayer.get(hatch.layer) ?? [];
    list.push(hatch);
    hatchesByLayer.set(hatch.layer, list);
  };

  for (const e of doc.entities) {
    addEntity(e, layersByName, getBucket, addText, addHatch);
  }

  // Promote each layer the parser saw — both from the LAYER table *and* any
  // extra layer names referenced only via entity tags — to a Group so the
  // viewer can list every layer the user might want to toggle.
  const layerOrder = new Map<string, number>();
  doc.layers.forEach((l, i) => {
    layerNames.add(l.name);
    layerOrder.set(l.name, i);
  });

  const sceneLayers: SceneLayer[] = [];
  const disposables: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  const textDisposables: TextDisposable[] = [];
  // R37 V-2 — every Line2 material the builder creates so the React layer
  // can update `resolution` on each resize. Hatch-pattern fills/outlines
  // intentionally stay on plain `LineBasicMaterial` and aren't tracked here.
  const lineMaterials: LineMaterial[] = [];
  const THREE_NS = THREE; // alias so the inner buildTextMesh closure reads cleaner

  // Stable ordering: LAYER-table order first, then any anonymous layers in
  // alpha order so the panel doesn't reshuffle on every load.
  const sortedLayerNames = Array.from(layerNames).sort((a, b) => {
    const oa = layerOrder.get(a);
    const ob = layerOrder.get(b);
    if (oa != null && ob != null) return oa - ob;
    if (oa != null) return -1;
    if (ob != null) return 1;
    return a.localeCompare(b);
  });

  for (const name of sortedLayerNames) {
    const meta = layersByName.get(name);
    const layerColor = meta ? meta.color : 7;
    const group = new THREE.Group();
    group.name = `layer:${name}`;
    group.visible = meta ? !meta.frozen : true;

    // R37 V-2 — emit one Line2 mesh per (layer, kind, line weight) bucket.
    // Iterate `buckets` rather than fishing keys directly so the new
    // pxKey-bearing key format stays an implementation detail.
    for (const [key, bucket] of buckets) {
      if (bucket.layer !== name) continue;
      if (bucket.positions.length === 0) continue;
      // Key shape: `${layer}::${kind}::${px}`. Pull the kind back out so
      // userData stays stable for any consumer that filters meshes by kind.
      const kindMatch = /::(lines|curves)::/.exec(key);
      const kind = (kindMatch?.[1] ?? 'lines') as 'lines' | 'curves';
      const mat = makeLineMaterial(bucket.color, layerColor, bucket.lineWeightPx);
      lineMaterials.push(mat);
      const geom = positionsToLineSegmentsGeometry(bucket.positions);
      const mesh = new LineSegments2(geom, mat);
      // LineSegments2 uses an InstancedBufferGeometry whose default
      // boundingSphere isn't recomputed automatically. We compute it once
      // here so frustum culling works correctly without forcing a per-frame
      // recompute.
      geom.computeBoundingSphere();
      mesh.userData.dxfKind = kind;
      group.add(mesh);
      disposables.push({ geometry: geom, material: mat });
    }
    // R10 — text per layer. Each TEXT/MTEXT becomes a textured plane at the
    // insertion point. A single material+texture per entity is fine for
    // typical drawings (≤ a few hundred labels); SDF font / atlas batching
    // is a Phase 3 concern.
    const layerTexts = textsByLayer.get(name);
    if (layerTexts && layerTexts.length > 0) {
      for (const t of layerTexts) {
        const built = buildTextMesh(THREE_NS, t, layerColor);
        if (built) {
          group.add(built.mesh);
          textDisposables.push(built);
        }
      }
    }

    // R12 — solid hatches per layer (triangulated mesh).
    // R25 — pattern hatches (ANSI31 / ANSI32 / DOTS) emit a LineSegments fill
    // plus a boundary outline. Both paths produce one or more Object3D nodes
    // and a list of disposables.
    const layerHatches = hatchesByLayer.get(name);
    if (layerHatches && layerHatches.length > 0) {
      for (const h of layerHatches) {
        const built = buildHatchMesh(THREE_NS, h, layerColor);
        if (built) {
          group.add(built.object);
          for (const d of built.disposables) disposables.push(d);
        } else {
          // Hard fallback: push the boundary loops as line segments so the
          // user at least sees the perimeter when no fill could be built
          // (e.g. degenerate loops < 3 vertices).
          const fbColor = aciToRgb(
            h.color === 256 || h.color === 0 ? layerColor : h.color,
          );
          // Boundary outlines use the hatch's resolved line weight (or the
          // layer default) so they keep the same visual emphasis the hatch
          // would have had at proper rendering time.
          const fbWeight = resolveLineWeightPx(h.lineWeight, meta?.lineWeight);
          const fbBucket = getBucket(name, 'lines', fbColor, fbWeight);
          for (const loop of h.loops) {
            for (let li = 0; li < loop.length - 1; li++) {
              const a = loop[li]!;
              const b = loop[li + 1]!;
              fbBucket.positions.push(a.x, a.y, 0, b.x, b.y, 0);
            }
            const last = loop[loop.length - 1]!;
            const first = loop[0]!;
            fbBucket.positions.push(
              last.x,
              last.y,
              0,
              first.x,
              first.y,
              0,
            );
          }
        }
      }
    }

    scene.add(group);
    sceneLayers.push({
      name,
      color: aciToRgb(layerColor),
      group,
      initiallyVisible: group.visible,
    });
  }

  return {
    scene,
    layers: sceneLayers,
    lineMaterials,
    setResolution(widthPx: number, heightPx: number) {
      // LineMaterial expects the *render target* resolution in CSS pixels
      // (it does its own dpr math). Guard against zero/NaN inputs that would
      // make the shader blow up — return early instead of writing garbage.
      if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx)) return;
      if (widthPx <= 0 || heightPx <= 0) return;
      for (const m of lineMaterials) {
        m.resolution.set(widthPx, heightPx);
      }
    },
    dispose() {
      for (const d of disposables) {
        d.geometry.dispose();
        d.material.dispose();
      }
      for (const d of textDisposables) {
        d.geometry.dispose();
        d.material.dispose();
        d.texture.dispose();
      }
      // Detach groups from the scene so the GC can reclaim them; three.js
      // doesn't traverse on its own here.
      while (scene.children.length > 0) scene.remove(scene.children[0]!);
    },
  };
}

interface TextDisposable {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  texture: THREE.Texture;
}

function addEntity(
  e: DxfEntity,
  layersByName: Map<string, DxfLayerInfo>,
  getBucket: (
    layer: string,
    kind: 'lines' | 'curves',
    color: number,
    lineWeightPx: number,
  ) => {
    layer: string;
    color: number;
    lineWeightPx: number;
    positions: number[];
  },
  addText: (text: TextEntity) => void,
  addHatch: (hatch: HatchEntity) => void,
): void {
  const layerMeta = layersByName.get(e.layer);
  // Color resolution: ByLayer falls back to the layer's color; ByBlock and
  // unrecognized entries fall to ACI 7 (foreground).
  const resolvedAci = e.color === 256
    ? (layerMeta?.color ?? 7)
    : e.color === 0
      ? (layerMeta?.color ?? 7)
      : e.color;
  const colorRgb = aciToRgb(resolvedAci);
  // R37 V-2 — resolve the entity's line weight against its layer default.
  const lineWeightPx = resolveLineWeightPx(e.lineWeight, layerMeta?.lineWeight);

  switch (e.kind) {
    case 'line': {
      const bucket = getBucket(e.layer, 'lines', colorRgb, lineWeightPx);
      pushLineSegment(bucket.positions, e);
      break;
    }
    case 'polyline': {
      const bucket = getBucket(e.layer, 'lines', colorRgb, lineWeightPx);
      pushPolyline(bucket.positions, e);
      break;
    }
    case 'circle': {
      const bucket = getBucket(e.layer, 'curves', colorRgb, lineWeightPx);
      pushCircle(bucket.positions, e);
      break;
    }
    case 'arc': {
      const bucket = getBucket(e.layer, 'curves', colorRgb, lineWeightPx);
      pushArc(bucket.positions, e);
      break;
    }
    case 'text': {
      addText(e);
      break;
    }
    case 'hatch': {
      addHatch(e);
      break;
    }
  }
}

/**
 * R12 / R25 — build a renderable for a HATCH entity. Returns either:
 *  - solid hatches: triangulated semi-transparent fill via THREE.Shape +
 *    ShapeGeometry (earcut runs internally). Outer loop = boundary, the rest
 *    become holes.
 *  - pattern hatches (R25): LineSegments crosshatch generated inside the
 *    boundary bounding box, point-in-polygon-clipped against the loops, plus
 *    an outline. Recognises ANSI31 (45°), ANSI32 (45°+135°), DOTS (short
 *    dashes), defaulting to ANSI31 for any unknown name.
 *
 * Returns null only when the loops are degenerate (< 3 vertices) so the
 * caller can fall back to the boundary-only outline path.
 */
function buildHatchMesh(
  THREE_NS: typeof THREE,
  hatch: HatchEntity,
  layerFallbackAci: number,
): {
  object: THREE.Object3D;
  disposables: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
} | null {
  const outer = hatch.loops[0];
  if (!outer || outer.length < 3) return null;

  const resolvedAci =
    hatch.color === 256 || hatch.color === 0 ? layerFallbackAci : hatch.color;
  const colorRgb = aciToRgb(resolvedAci);

  if (hatch.solid) {
    const shape = new THREE_NS.Shape();
    shape.moveTo(outer[0]!.x, outer[0]!.y);
    for (let i = 1; i < outer.length; i++) {
      shape.lineTo(outer[i]!.x, outer[i]!.y);
    }
    shape.closePath();

    for (let li = 1; li < hatch.loops.length; li++) {
      const loop = hatch.loops[li]!;
      if (loop.length < 3) continue;
      const hole = new THREE_NS.Path();
      hole.moveTo(loop[0]!.x, loop[0]!.y);
      for (let i = 1; i < loop.length; i++) {
        hole.lineTo(loop[i]!.x, loop[i]!.y);
      }
      hole.closePath();
      shape.holes.push(hole);
    }

    let geom: THREE.ShapeGeometry;
    try {
      geom = new THREE_NS.ShapeGeometry(shape);
    } catch {
      return null;
    }

    const mat = new THREE_NS.MeshBasicMaterial({
      color: colorRgb,
      transparent: true,
      opacity: 0.45, // see-through so overlapping line work stays visible
      side: THREE_NS.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE_NS.Mesh(geom, mat);
    // Render hatches *behind* line work — set z slightly negative so they sit
    // under the LineSegments drawn at z=0.
    mesh.position.z = -0.01;
    mesh.userData.dxfKind = 'hatch';
    return { object: mesh, disposables: [{ geometry: geom, material: mat }] };
  }

  // ── R25 pattern hatch · R30 accurate polygon clipping ──────────────────
  const angles = anglesForPattern(hatch.patternName);
  const baseAngle = hatch.patternAngle ?? 0;
  const scale = hatch.patternScale && hatch.patternScale > 0 ? hatch.patternScale : 1;
  const spacing = Math.max(0.5, scale * 1.0);
  const isDots = (hatch.patternName ?? '').toUpperCase() === 'DOTS';

  // Build the outline first (always present) so the boundary stays visible
  // even if the clip filters out every fill segment.
  const outlinePositions: number[] = [];
  for (const loop of hatch.loops) {
    for (let li = 0; li < loop.length - 1; li++) {
      const a = loop[li]!;
      const b = loop[li + 1]!;
      outlinePositions.push(a.x, a.y, 0, b.x, b.y, 0);
    }
    const last = loop[loop.length - 1]!;
    const first = loop[0]!;
    outlinePositions.push(last.x, last.y, 0, first.x, first.y, 0);
  }

  // Bounding box from the outer loop — pattern lines sweep across this AABB.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // Tiny margin so a line that grazes a vertex still gets a chance to be
  // clipped (makes the line span guaranteed to extend past the polygon).
  const margin = spacing;
  minX -= margin; minY -= margin; maxX += margin; maxY += margin;
  const bboxDiag = Math.hypot(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const fillPositions: number[] = [];

  if (isDots) {
    // ── DOTS: lattice grid sampling, point-in-polygon, exact boundary ──
    // Dots that fall inside the hatch area are emitted as tiny axis-aligned
    // dashes. Dash length stays under `spacing/2` so the dash itself can't
    // straddle the boundary even at the worst case (dash centre exactly on
    // an edge). We also clip the dash against the polygon as an additional
    // safety so a dot near a thin neck never bleeds out.
    const dashLen = Math.max(0.05, spacing * 0.2);
    const halfDash = dashLen / 2;
    const startX = Math.floor(minX / spacing) * spacing;
    const startY = Math.floor(minY / spacing) * spacing;
    for (let py = startY; py <= maxY; py += spacing) {
      for (let px = startX; px <= maxX; px += spacing) {
        if (!pointInHatch(px, py, hatch.loops)) continue;
        // Clip the candidate dash so even if `pointInHatch` is true but the
        // dash extent crosses a hole/outer edge, only the in-polygon part
        // survives. For typical drawings this is a no-op (dash << spacing).
        const segs = clipSegmentToHatch(
          px - halfDash, py,
          px + halfDash, py,
          hatch.loops,
        );
        for (const s of segs) {
          fillPositions.push(s.ax, s.ay, 0, s.bx, s.by, 0);
        }
      }
    }
  } else {
    // ── ANSI31 / ANSI32 / unknown: line-set crosshatch with exact clip ──
    // For each pattern angle we sweep a family of parallel lines through the
    // bbox centre and clip each line precisely against the polygon (outer
    // boundary AND its holes) using analytic edge intersection + midpoint
    // inside-test. The result is leak-free at the boundary regardless of
    // sampling density.
    for (const angDeg of angles) {
      const angle = ((angDeg + baseAngle) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // Sweep `t` (perpendicular offset from centre) in `spacing` steps.
      // Range of `t` covers the whole bbox so every line that could touch
      // the polygon gets a chance.
      const halfRange = bboxDiag / 2 + spacing;
      for (let t = -halfRange; t <= halfRange; t += spacing) {
        const ax = cx - sin * t - cos * bboxDiag;
        const ay = cy + cos * t - sin * bboxDiag;
        const bx = cx - sin * t + cos * bboxDiag;
        const by = cy + cos * t + sin * bboxDiag;
        const segs = clipSegmentToHatch(ax, ay, bx, by, hatch.loops);
        for (const s of segs) {
          fillPositions.push(s.ax, s.ay, 0, s.bx, s.by, 0);
        }
      }
    }
  }

  const group = new THREE_NS.Group();
  group.userData.dxfKind = 'hatch-pattern';
  group.position.z = -0.005;
  const disposables: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];

  if (fillPositions.length > 0) {
    const fillGeom = new THREE_NS.BufferGeometry();
    fillGeom.setAttribute(
      'position',
      new THREE_NS.BufferAttribute(new Float32Array(fillPositions), 3),
    );
    const fillMat = new THREE_NS.LineBasicMaterial({ color: colorRgb, linewidth: 1 });
    const fillMesh = new THREE_NS.LineSegments(fillGeom, fillMat);
    fillMesh.userData.dxfKind = 'hatch-pattern-fill';
    group.add(fillMesh);
    disposables.push({ geometry: fillGeom, material: fillMat });
  }

  // Always emit the outline so the user sees the boundary, even if the fill
  // came back empty (e.g. all-hole / very thin loops).
  const outlineGeom = new THREE_NS.BufferGeometry();
  outlineGeom.setAttribute(
    'position',
    new THREE_NS.BufferAttribute(new Float32Array(outlinePositions), 3),
  );
  const outlineMat = new THREE_NS.LineBasicMaterial({ color: colorRgb, linewidth: 1 });
  const outlineMesh = new THREE_NS.LineSegments(outlineGeom, outlineMat);
  outlineMesh.userData.dxfKind = 'hatch-pattern-outline';
  group.add(outlineMesh);
  disposables.push({ geometry: outlineGeom, material: outlineMat });

  return { object: group, disposables };
}

/**
 * Pattern angle table. Returns the base angle set (degrees, CCW from +X) for
 * a known AutoCAD-style hatch name. Unknown patterns fall back to ANSI31.
 *
 * The patternAngle from the DXF is added on top in the caller.
 */
function anglesForPattern(name: string | undefined): number[] {
  const upper = (name ?? '').toUpperCase();
  switch (upper) {
    case 'ANSI31':
      return [45];
    case 'ANSI32':
      return [45, 135];
    case 'DOTS':
      // Dots are sampled along axis-aligned lines so the grid is regular.
      return [0, 90];
    default:
      // Most field DXFs use ANSI31; this also covers SOLID-but-misflagged
      // entities (rare but observed) without crashing the renderer.
      return [45];
  }
}

/**
 * Point-in-polygon test that respects HATCH loop convention: the first loop
 * is the outer boundary, subsequent loops are holes. A point is "inside the
 * hatched area" when it's inside the outer ring AND outside every hole.
 *
 * Uses the standard ray-casting algorithm — count how many polygon edges a
 * horizontal ray (y = py, x → +∞) crosses. Odd ⇒ inside. Vertices touching
 * the ray are handled by treating the lower-y vertex as inclusive and the
 * higher-y vertex as exclusive, which avoids double-counting at corners.
 */
function pointInHatch(px: number, py: number, loops: { x: number; y: number }[][]): boolean {
  const ringCount = loops.length;
  if (ringCount === 0) return false;
  if (!pointInRing(px, py, loops[0]!)) return false;
  for (let i = 1; i < ringCount; i++) {
    if (pointInRing(px, py, loops[i]!)) return false;
  }
  return true;
}

function pointInRing(px: number, py: number, ring: { x: number; y: number }[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i]!.x;
    const yi = ring[i]!.y;
    const xj = ring[j]!.x;
    const yj = ring[j]!.y;
    // Half-open edge convention: edge spans [min(yi,yj), max(yi,yj)).
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * R30 V-1 — exact line-segment clipping against a HATCH boundary.
 *
 * The hatch area is `outer ∧ ¬holes` (HATCH semantics: first loop = outer,
 * subsequent loops = holes). To clip a segment we collect the parameters
 * `t ∈ [0, 1]` at which the segment crosses any ring edge, sort them, then
 * walk adjacent intervals and emit those whose midpoint is inside the hatch
 * area. This is exact at the boundary because every entry/exit transition
 * lands on a real intersection — no sampling noise.
 *
 * Returns an array of in-polygon sub-segments. The function is exported so
 * the dot-grid path (and any future feature) can reuse the same primitive.
 *
 * Edge cases handled:
 *  - segment fully inside  → returns the whole segment
 *  - segment fully outside → returns []
 *  - segment endpoints on an edge → t=0 or t=1 are added explicitly so the
 *    inside/outside classification still works on the bounding intervals
 *  - parallel/colinear edges (denominator ≈ 0) are skipped: their
 *    contribution to in/out parity is degenerate and the classification
 *    by midpoint sampling still yields correct in/out for any non-degenerate
 *    sub-interval.
 */
export function clipSegmentToHatch(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  loops: { x: number; y: number }[][],
): Array<{ ax: number; ay: number; bx: number; by: number }> {
  if (loops.length === 0) return [];

  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return [];

  // Collect t-values where the segment intersects any ring edge.
  const ts: number[] = [0, 1];
  const EPS = 1e-9;
  for (const ring of loops) {
    const n = ring.length;
    if (n < 2) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const p = ring[j]!;
      const q = ring[i]!;
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      // Solve  a + t·d = p + u·e  for t, u.
      // | dx  -ex | |t|   | px - ax |
      // | dy  -ey | |u| = | py - ay |
      const denom = dx * (-ey) - dy * (-ex); // = dy*ex - dx*ey
      if (Math.abs(denom) < EPS) continue; // parallel — skip (parity stable)
      const rhsx = p.x - ax;
      const rhsy = p.y - ay;
      const t = (rhsx * -ey - rhsy * -ex) / denom;
      const u = (dx * rhsy - dy * rhsx) / denom;
      if (t < -EPS || t > 1 + EPS) continue;
      if (u < -EPS || u > 1 + EPS) continue;
      // Clamp to the segment range so endpoints exactly hit boundaries.
      ts.push(Math.max(0, Math.min(1, t)));
    }
  }

  // Sort + dedupe.
  ts.sort((a, b) => a - b);
  const merged: number[] = [ts[0]!];
  for (let i = 1; i < ts.length; i++) {
    if (ts[i]! - merged[merged.length - 1]! > EPS) merged.push(ts[i]!);
  }
  if (merged.length < 2) return [];

  const out: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const t0 = merged[i]!;
    const t1 = merged[i + 1]!;
    if (t1 - t0 < EPS) continue;
    // Midpoint inside-test decides whether this sub-interval lies inside
    // the hatch area. Cheap: one ray-cast per ring.
    const tm = (t0 + t1) / 2;
    const mx = ax + dx * tm;
    const my = ay + dy * tm;
    if (!pointInHatch(mx, my, loops)) continue;
    out.push({
      ax: ax + dx * t0,
      ay: ay + dy * t0,
      bx: ax + dx * t1,
      by: ay + dy * t1,
    });
  }

  // Coalesce adjacent sub-segments (same direction, shared endpoint) to keep
  // the output BufferGeometry compact. Two segments are mergeable when the
  // tail of the previous matches the head of the next within EPS.
  if (out.length < 2) return out;
  const coalesced: Array<{ ax: number; ay: number; bx: number; by: number }> = [out[0]!];
  for (let i = 1; i < out.length; i++) {
    const prev = coalesced[coalesced.length - 1]!;
    const cur = out[i]!;
    if (
      Math.abs(prev.bx - cur.ax) < EPS &&
      Math.abs(prev.by - cur.ay) < EPS
    ) {
      prev.bx = cur.bx;
      prev.by = cur.by;
    } else {
      coalesced.push(cur);
    }
  }
  return coalesced;
}

/**
 * Build a Three.js mesh that paints `text` onto a quad sized in DXF model
 * units. We rasterize to a HiDPI canvas the first time, then reuse the
 * texture via three's CanvasTexture. Phase 2 caps quality at canvas — SDF
 * fonts come back if performance demands it.
 */
function buildTextMesh(
  THREE_NS: typeof THREE,
  text: TextEntity,
  layerFallbackAci: number,
): TextDisposable | null {
  if (typeof document === 'undefined') return null; // SSR / worker — no canvas
  const lines = text.content.split('\n');
  const longest = lines.reduce<string>(
    (m, l) => (l.length > m.length ? l : m),
    lines[0] ?? '',
  );

  // Canvas size: scale up by `pxPerUnit` so the texture has enough resolution
  // for screen zoom. 32 px per model unit gives crisp text at typical zooms
  // and stays under WebGL's 4096 limit even for long labels.
  const pxPerUnit = 32;
  const charW = text.height * 0.6;
  const widthUnits = Math.max(text.height, charW * longest.length);
  const heightUnits = text.height * lines.length * 1.2;
  const cssWidth = Math.min(2048, Math.max(8, Math.ceil(widthUnits * pxPerUnit)));
  const cssHeight = Math.min(1024, Math.max(8, Math.ceil(heightUnits * pxPerUnit)));

  const canvas = document.createElement('canvas');
  canvas.width = cssWidth;
  canvas.height = cssHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const resolvedAci =
    text.color === 256 || text.color === 0 ? layerFallbackAci : text.color;
  const colorHex = '#' + aciToRgb(resolvedAci).toString(16).padStart(6, '0');
  ctx.fillStyle = colorHex;
  // Use a stack of common system fonts; CAD docs are usually Latin-only and
  // the actual SHX font isn't shipped. Drawing-board font is acceptable.
  const fontPx = Math.floor(text.height * pxPerUnit);
  ctx.font = `${fontPx}px "Segoe UI", "Noto Sans CJK KR", sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, 0, i * fontPx * 1.2);
  }

  const texture = new THREE_NS.CanvasTexture(canvas);
  texture.minFilter = THREE_NS.LinearFilter;
  texture.magFilter = THREE_NS.LinearFilter;
  texture.needsUpdate = true;

  // Plane geometry sized in DXF model units so the text scales naturally with
  // the camera. anchor = bottom-left to match DXF TEXT insertion-point convention.
  const geom = new THREE_NS.PlaneGeometry(widthUnits, heightUnits);
  geom.translate(widthUnits / 2, heightUnits / 2, 0);
  // hAlign 1 (center) / 2 (right) — shift the geometry so the insertion
  // point lands at the requested anchor.
  if (text.hAlign === 1) geom.translate(-widthUnits / 2, 0, 0);
  else if (text.hAlign === 2) geom.translate(-widthUnits, 0, 0);

  const mat = new THREE_NS.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE_NS.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE_NS.Mesh(geom, mat);
  mesh.position.set(text.position.x, text.position.y, 0);
  if (text.rotation !== 0) {
    mesh.rotation.z = (text.rotation * Math.PI) / 180;
  }
  mesh.userData.dxfKind = 'text';

  return { mesh, geometry: geom, material: mat, texture };
}

// ── Geometry pushers (Z is always 0 for Phase 1) ──────────────────────────

function pushLineSegment(out: number[], e: LineEntity): void {
  out.push(e.p1.x, e.p1.y, 0, e.p2.x, e.p2.y, 0);
}

function pushPolyline(out: number[], e: PolylineEntity): void {
  // LineSegments wants (a→b)(b→c)(c→d)... so we duplicate every interior point.
  const pts = e.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    out.push(a.x, a.y, 0, b.x, b.y, 0);
  }
  if (e.closed && pts.length >= 2) {
    const last = pts[pts.length - 1]!;
    const first = pts[0]!;
    out.push(last.x, last.y, 0, first.x, first.y, 0);
  }
}

function pushCircle(out: number[], e: CircleEntity): void {
  const segments = SEGMENTS_PER_REVOLUTION;
  const step = (Math.PI * 2) / segments;
  for (let i = 0; i < segments; i++) {
    const a = i * step;
    const b = (i + 1) * step;
    out.push(
      e.center.x + Math.cos(a) * e.radius,
      e.center.y + Math.sin(a) * e.radius,
      0,
      e.center.x + Math.cos(b) * e.radius,
      e.center.y + Math.sin(b) * e.radius,
      0,
    );
  }
}

function pushArc(out: number[], e: ArcEntity): void {
  const startRad = (e.startAngle * Math.PI) / 180;
  let endRad = (e.endAngle * Math.PI) / 180;
  // DXF arcs sweep CCW from start to end; if end <= start, add 2π.
  if (endRad <= startRad) endRad += Math.PI * 2;
  const sweep = endRad - startRad;
  const segments = Math.max(
    2,
    Math.ceil((sweep / (Math.PI * 2)) * SEGMENTS_PER_REVOLUTION),
  );
  const step = sweep / segments;
  for (let i = 0; i < segments; i++) {
    const a = startRad + i * step;
    const b = startRad + (i + 1) * step;
    out.push(
      e.center.x + Math.cos(a) * e.radius,
      e.center.y + Math.sin(a) * e.radius,
      0,
      e.center.x + Math.cos(b) * e.radius,
      e.center.y + Math.sin(b) * e.radius,
      0,
    );
  }
}

/**
 * R37 V-2 — pack a flat XY-pair list into a `LineSegmentsGeometry` ready for
 * `LineSegments2`. The geometry's `setPositions` accepts a Float32Array of
 * (start.xyz, end.xyz) pairs — same layout as our existing buckets — so the
 * call is a one-liner.
 */
function positionsToLineSegmentsGeometry(positions: number[]): LineSegmentsGeometry {
  const geom = new LineSegmentsGeometry();
  // setPositions copies the data into an InstancedInterleavedBuffer. We pass
  // a Float32Array directly to skip a redundant intermediate copy.
  geom.setPositions(new Float32Array(positions));
  return geom;
}

function makeLineMaterial(
  rgb: number,
  layerFallbackAci: number,
  linewidthPx: number,
): LineMaterial {
  // Caller passes the *already resolved* RGB (entity color); we only fall
  // back to the layer color when the resolution returned the document
  // foreground default (which means "no color supplied"). Most callers
  // supply real colors and skip the branch.
  const color = rgb === DEFAULT_FOREGROUND ? aciToRgb(layerFallbackAci) : rgb;
  // LineMaterial requires a non-zero `resolution`; the React shell pushes
  // the live canvas size in via `BuiltScene.setResolution` immediately
  // after build, but we initialise to a sane default so any pre-mount
  // `boundingSphere` recompute / unit test doesn't divide by zero.
  const mat = new LineMaterial({
    color,
    linewidth: linewidthPx,
    // Disabled: when true, `linewidth` is interpreted in world units and
    // the resolution uniform stops being read. We want screen-space pixels
    // so the stroke stays the same physical thickness regardless of zoom.
    worldUnits: false,
    // Tested with `transparent: true` first; the fragment shader writes
    // alpha-coverage at the edge anyway and turning it off keeps depth
    // ordering simple (no depthWrite guard required).
    transparent: false,
    dashed: false,
  });
  mat.resolution = new THREE.Vector2(DEFAULT_RESOLUTION_W, DEFAULT_RESOLUTION_H);
  return mat;
}

/** Helper exported for tests / measurement code that needs to know the
 *  bounding box of the assembled scene. Kept separate from `buildScene` so
 *  callers don't have to traverse the scene graph themselves. */
export function sceneBounds(doc: DxfDocument): {
  center: V2;
  size: V2;
} {
  const { min, max } = doc.bounds;
  return {
    center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 },
    size: { x: max.x - min.x, y: max.y - min.y },
  };
}
