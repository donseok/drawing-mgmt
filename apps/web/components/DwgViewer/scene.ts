// DXF entity tree → three.js scene builder.
//
// Phase 1 strategy: one BufferGeometry per (layer × geometry kind) bucket.
// "Per layer" lets us toggle visibility cheaply via Group.visible. "Per kind"
// keeps line- vs arc-segment math separate so a single LineSegments draw call
// can render thousands of LINEs without per-entity object overhead. Curved
// entities (arc, circle) are tessellated to LINE_SEGMENTS_PER_REVOLUTION.
//
// What we explicitly DON'T do here:
//   - LOD / per-frame retessellation. Phase 1 picks a single segment count
//     and lives with it. LOD comes back when zoom-aware rendering ships.
//   - Line thickness. WebGL's stock LINES are 1px; promoting to Line2 needs
//     a separate material per layer and is deferred until users ask.
//   - Text / inserts / hatches. Parser already drops those; the builder just
//     mirrors that scope.

import * as THREE from 'three';

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

  // Bucket entities by (layer, kind) — separate buckets for lines vs curve
  // segments so each gets its own draw call.
  type BucketKey = `${string}::${'lines' | 'curves'}`;
  interface Bucket {
    layer: string;
    color: number;
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

  const getBucket = (layer: string, kind: 'lines' | 'curves', color: number) => {
    layerNames.add(layer);
    const key: BucketKey = `${layer}::${kind}`;
    const existing = buckets.get(key);
    if (existing) return existing;
    const next: Bucket = { layer, color, positions: [] };
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

    const linesBucket = buckets.get(`${name}::lines`);
    if (linesBucket && linesBucket.positions.length > 0) {
      const mat = makeLineMaterial(linesBucket.color, layerColor);
      const geom = positionsToBufferGeometry(linesBucket.positions);
      const mesh = new THREE.LineSegments(geom, mat);
      mesh.userData.dxfKind = 'lines';
      group.add(mesh);
      disposables.push({ geometry: geom, material: mat });
    }
    const curvesBucket = buckets.get(`${name}::curves`);
    if (curvesBucket && curvesBucket.positions.length > 0) {
      const mat = makeLineMaterial(curvesBucket.color, layerColor);
      const geom = positionsToBufferGeometry(curvesBucket.positions);
      const mesh = new THREE.LineSegments(geom, mat);
      mesh.userData.dxfKind = 'curves';
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

    // R12 — solid hatches per layer. Pattern hatches degrade to outline
    // (ShapeGeometry can't render the pattern; we fall back so the user at
    // least sees the boundary loop).
    const layerHatches = hatchesByLayer.get(name);
    if (layerHatches && layerHatches.length > 0) {
      for (const h of layerHatches) {
        const built = buildHatchMesh(THREE_NS, h, layerColor);
        if (built) {
          group.add(built.mesh);
          disposables.push({
            geometry: built.geometry,
            material: built.material,
          });
        } else {
          // Fallback: push the boundary loops as line segments so the user
          // at least sees the perimeter when the fill couldn't be built.
          const fbColor = aciToRgb(
            h.color === 256 || h.color === 0 ? layerColor : h.color,
          );
          const fbBucket = getBucket(name, 'lines', fbColor);
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
  getBucket: (layer: string, kind: 'lines' | 'curves', color: number) => {
    layer: string;
    color: number;
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

  switch (e.kind) {
    case 'line': {
      const bucket = getBucket(e.layer, 'lines', colorRgb);
      pushLineSegment(bucket.positions, e);
      break;
    }
    case 'polyline': {
      const bucket = getBucket(e.layer, 'lines', colorRgb);
      pushPolyline(bucket.positions, e);
      break;
    }
    case 'circle': {
      const bucket = getBucket(e.layer, 'curves', colorRgb);
      pushCircle(bucket.positions, e);
      break;
    }
    case 'arc': {
      const bucket = getBucket(e.layer, 'curves', colorRgb);
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
 * R12 — turn a HATCH (solid only) into a triangulated mesh via THREE.Shape.
 * The first loop is the outer boundary; subsequent loops become holes via
 * Shape.holes. ShapeGeometry runs earcut internally so we don't ship our
 * own triangulator. Returns null for non-solid (pattern) hatches and for
 * loops too small to triangulate — the caller falls back to outline.
 */
function buildHatchMesh(
  THREE_NS: typeof THREE,
  hatch: HatchEntity,
  layerFallbackAci: number,
): { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; material: THREE.Material } | null {
  if (!hatch.solid) return null;
  const outer = hatch.loops[0];
  if (!outer || outer.length < 3) return null;

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

  const resolvedAci =
    hatch.color === 256 || hatch.color === 0 ? layerFallbackAci : hatch.color;
  const colorRgb = aciToRgb(resolvedAci);

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
  return { mesh, geometry: geom, material: mat };
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

function positionsToBufferGeometry(positions: number[]): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  // Float32Array for GPU upload — flat copy beats per-vertex Vector3 hot
  // path which is what the spec warns about.
  const arr = new Float32Array(positions);
  geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return geom;
}

function makeLineMaterial(rgb: number, layerFallbackAci: number): THREE.LineBasicMaterial {
  // Caller passes the *already resolved* RGB (entity color); we only fall
  // back to the layer color when the resolution returned the document
  // foreground default (which means "no color supplied"). Most callers
  // supply real colors and skip the branch.
  const color = rgb === DEFAULT_FOREGROUND ? aciToRgb(layerFallbackAci) : rgb;
  return new THREE.LineBasicMaterial({ color, linewidth: 1 });
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
