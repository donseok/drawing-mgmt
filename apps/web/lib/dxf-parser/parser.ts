// ASCII DXF parser — Phase 1 entity coverage: LINE / CIRCLE / ARC /
// LWPOLYLINE / POLYLINE+VERTEX. Everything else is recorded in
// `unsupportedKinds` and skipped (no throw).
//
// DXF ASCII is a flat sequence of (code, value) pairs:
//
//     0
//     LINE
//     8
//     MyLayer
//     10
//     1.5
//     ...
//
// We walk pairs forward and dispatch on `0` boundaries. Each entity reader
// owns its own per-code switch; this keeps the dispatch small and avoids the
// "one giant entity object" antipattern.
//
// Error policy:
//   - Truncated or malformed pairs → throw with the offending line range.
//   - Unknown entity types → console.warn once per kind, then skip until the
//     next `0` tag.
//   - Out-of-spec sub-codes inside a known entity → ignored silently (best
//     effort; common in field-collected DXFs).

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
} from './types';

interface CodePair {
  code: number;
  value: string;
  /** 1-based line number of the *value* line for error reporting. */
  line: number;
}

function tokenize(input: string): CodePair[] {
  const lines = input.split(/\r\n|\r|\n/);
  const pairs: CodePair[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Each pair is two consecutive non-empty lines: a numeric code, then the
    // value. Trailing whitespace is tolerated; blank lines aren't allowed
    // mid-pair but appear at the file end of CR/LF DXFs from some CAD apps.
    const codeRaw = lines[i]?.trim();
    if (codeRaw == null || codeRaw === '') {
      continue;
    }
    const code = Number.parseInt(codeRaw, 10);
    if (!Number.isFinite(code)) {
      // Allow trailing garbage at EOF; otherwise surface as a parse error.
      if (i >= lines.length - 2) break;
      throw new Error(
        `DXF parse error: expected group code at line ${i + 1}, got "${codeRaw}"`,
      );
    }
    const value = lines[++i] ?? '';
    pairs.push({ code, value: value.trim(), line: i + 1 });
  }
  return pairs;
}

export function parseDxf(input: string): DxfDocument {
  const pairs = tokenize(input);

  const layers: DxfLayerInfo[] = [];
  const entities: DxfEntity[] = [];
  const unsupported = new Set<string>();
  let insUnits = 4; // mm default
  let extMin: V2 | null = null;
  let extMax: V2 | null = null;
  // R11 — BLOCKS dict, populated before ENTITIES so INSERT lookups inside
  // ENTITIES can expand against an already-known block table. Same-pass
  // pre-scan finds the BLOCKS section and reads it first regardless of file
  // order (Autodesk products always emit BLOCKS before ENTITIES, but ezdxf
  // and other writers don't always honor that).
  const blocks = new Map<string, BlockDef>();

  // First pass: locate sections.
  const sectionRanges: Array<{ name: string; start: number; end: number }> = [];
  {
    let i = 0;
    while (i < pairs.length) {
      const p = pairs[i]!;
      if (p.code === 0 && p.value === 'SECTION') {
        const nameTag = pairs[i + 1];
        if (nameTag && nameTag.code === 2) {
          const endIdx = findSectionEnd(pairs, i + 2);
          sectionRanges.push({
            name: nameTag.value,
            start: i + 2,
            end: endIdx,
          });
          i = endIdx + 1;
          continue;
        }
      }
      if (p.code === 0 && p.value === 'EOF') break;
      i++;
    }
  }

  const sectionByName = new Map<string, { start: number; end: number }>();
  for (const r of sectionRanges)
    sectionByName.set(r.name, { start: r.start, end: r.end });

  // Process in dependency order: HEADER → TABLES → BLOCKS → ENTITIES.
  const headerRange = sectionByName.get('HEADER');
  if (headerRange) {
    const slice = pairs.slice(headerRange.start, headerRange.end);
    readHeader(slice, (key, v) => {
      if (key === '$INSUNITS' && v.length > 0) {
        const n = Number.parseInt(v[0]!.value, 10);
        if (Number.isFinite(n)) insUnits = n;
      } else if (key === '$EXTMIN') {
        extMin = readPoint(v);
      } else if (key === '$EXTMAX') {
        extMax = readPoint(v);
      }
    });
  }
  const tablesRange = sectionByName.get('TABLES');
  if (tablesRange) {
    readTables(pairs.slice(tablesRange.start, tablesRange.end), layers);
  }
  const blocksRange = sectionByName.get('BLOCKS');
  if (blocksRange) {
    readBlocks(
      pairs.slice(blocksRange.start, blocksRange.end),
      blocks,
      unsupported,
    );
  }
  const entitiesRange = sectionByName.get('ENTITIES');
  if (entitiesRange) {
    readEntities(
      pairs.slice(entitiesRange.start, entitiesRange.end),
      entities,
      unsupported,
      blocks,
    );
  }

  // Bounds: prefer header values when both present and non-degenerate;
  // otherwise compute from entity geometry so the camera can fit the doc.
  const headerBounds = boundsFromHeader(extMin, extMax);
  const bounds = headerBounds ?? boundsFromEntities(entities) ?? {
    min: { x: 0, y: 0 },
    max: { x: 100, y: 100 },
  };

  return {
    bounds,
    insUnits,
    layers,
    entities,
    unsupportedKinds: Array.from(unsupported).sort(),
  };
}

// ── helpers ───────────────────────────────────────────────────────────────

function findSectionEnd(pairs: CodePair[], from: number): number {
  for (let j = from; j < pairs.length; j++) {
    const p = pairs[j]!;
    if (p.code === 0 && p.value === 'ENDSEC') return j;
    if (p.code === 0 && p.value === 'EOF') return j; // tolerate missing ENDSEC
  }
  return pairs.length;
}

/**
 * Header section format: 9/<key> followed by one or more value pairs.
 * `onVar` receives the key plus the value pairs that belong to it (until the
 * next 9-tag or section end).
 */
function readHeader(
  slice: CodePair[],
  onVar: (key: string, values: CodePair[]) => void,
): void {
  let i = 0;
  while (i < slice.length) {
    const p = slice[i]!;
    if (p.code !== 9) {
      i++;
      continue;
    }
    const key = p.value;
    const values: CodePair[] = [];
    let j = i + 1;
    while (j < slice.length && slice[j]!.code !== 9) {
      values.push(slice[j]!);
      j++;
    }
    onVar(key, values);
    i = j;
  }
}

function readPoint(values: CodePair[]): V2 | null {
  let x: number | null = null;
  let y: number | null = null;
  for (const v of values) {
    if (v.code === 10) x = parseFloat(v.value);
    else if (v.code === 20) y = parseFloat(v.value);
  }
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function boundsFromHeader(
  min: V2 | null,
  max: V2 | null,
): DxfDocument['bounds'] | null {
  if (!min || !max) return null;
  // Some CAD apps write 1e20 / -1e20 sentinels when the doc is empty.
  if (
    Math.abs(min.x) >= 1e19 ||
    Math.abs(min.y) >= 1e19 ||
    Math.abs(max.x) >= 1e19 ||
    Math.abs(max.y) >= 1e19
  ) {
    return null;
  }
  if (min.x === max.x && min.y === max.y) return null;
  return { min, max };
}

function boundsFromEntities(entities: DxfEntity[]): DxfDocument['bounds'] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const expand = (p: V2) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const e of entities) {
    switch (e.kind) {
      case 'line':
        expand(e.p1);
        expand(e.p2);
        break;
      case 'circle':
        expand({ x: e.center.x - e.radius, y: e.center.y - e.radius });
        expand({ x: e.center.x + e.radius, y: e.center.y + e.radius });
        break;
      case 'arc': {
        // Worst-case bound = bounding circle. Tight bounds would require
        // sampling start/end + axis crossings; the camera fit doesn't need
        // pixel-perfect tightness in Phase 1.
        expand({ x: e.center.x - e.radius, y: e.center.y - e.radius });
        expand({ x: e.center.x + e.radius, y: e.center.y + e.radius });
        break;
      }
      case 'polyline':
        for (const p of e.points) expand(p);
        break;
      case 'text':
        // Worst-case: assume text width ≈ 0.6 × height × char count. We
        // expand around the insertion point in both directions because
        // the actual horizontal extent depends on hAlign which would need
        // a font metric.
        {
          const w = Math.max(
            e.height,
            e.height * 0.6 * Math.max(1, e.content.length),
          );
          expand({ x: e.position.x - w, y: e.position.y - e.height });
          expand({ x: e.position.x + w, y: e.position.y + e.height });
        }
        break;
      case 'hatch':
        for (const loop of e.loops) {
          for (const p of loop) expand(p);
        }
        break;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

// ── TABLES (LAYER) ────────────────────────────────────────────────────────

function readTables(slice: CodePair[], layers: DxfLayerInfo[]): void {
  let i = 0;
  while (i < slice.length) {
    const p = slice[i]!;
    if (p.code === 0 && p.value === 'TABLE') {
      const nameTag = slice[i + 1];
      if (nameTag?.code === 2 && nameTag.value === 'LAYER') {
        // Walk LAYER entries until the matching ENDTAB.
        let j = i + 2;
        while (j < slice.length) {
          const q = slice[j]!;
          if (q.code === 0 && q.value === 'ENDTAB') {
            i = j;
            break;
          }
          if (q.code === 0 && q.value === 'LAYER') {
            const next = readLayer(slice, j + 1);
            if (next.layer) layers.push(next.layer);
            j = next.next;
            continue;
          }
          j++;
        }
      }
    }
    i++;
  }
}

function readLayer(
  slice: CodePair[],
  from: number,
): { layer: DxfLayerInfo | null; next: number } {
  let name = '';
  let color = 7;
  let flags = 0;
  // R37 — DXF group 370 on a LAYER record carries the layer-default line
  // weight (1/100 mm, with `-3` = LWDEFAULT). Stays optional so test fixtures
  // and pre-R13 LAYER tables that omit the code parse cleanly.
  let lineWeight: number | undefined;
  let j = from;
  for (; j < slice.length; j++) {
    const p = slice[j]!;
    if (p.code === 0) break;
    if (p.code === 2) name = p.value;
    else if (p.code === 62) color = Number.parseInt(p.value, 10) || 7;
    else if (p.code === 70) flags = Number.parseInt(p.value, 10) || 0;
    else if (p.code === 370) {
      const n = Number.parseInt(p.value, 10);
      if (Number.isFinite(n)) lineWeight = n;
    }
  }
  if (!name) return { layer: null, next: j };
  const layer: DxfLayerInfo = {
    name,
    // Negative color in the LAYER table means the layer is off — we treat
    // off-layers as visible-but-grey rather than hiding entirely so users
    // can manually toggle.
    color: Math.abs(color),
    frozen: (flags & 1) === 1,
  };
  if (lineWeight !== undefined) layer.lineWeight = lineWeight;
  return { layer, next: j };
}

// ── ENTITIES ──────────────────────────────────────────────────────────────

function readEntities(
  slice: CodePair[],
  out: DxfEntity[],
  unsupported: Set<string>,
  blocks: Map<string, BlockDef>,
): void {
  let i = 0;
  while (i < slice.length) {
    const p = slice[i]!;
    if (p.code !== 0) {
      i++;
      continue;
    }
    const kind = p.value;
    // Walk forward to the next 0-tag; the slice between is this entity.
    let j = i + 1;
    while (j < slice.length && slice[j]!.code !== 0) j++;
    const entityPairs = slice.slice(i + 1, j);

    if (kind === 'INSERT') {
      // R11 — expand the INSERT into transformed copies of the referenced
      // block's entities. Unknown blocks are recorded in `unsupported` so
      // the FE can surface a hint without crashing the renderer.
      const insert = readInsertHeader(entityPairs);
      if (insert) {
        const block = blocks.get(insert.blockName);
        if (block) {
          expandBlock(block, insert, blocks, out, 0, unsupported);
        } else {
          unsupported.add(`INSERT(${insert.blockName})`);
        }
      } else {
        unsupported.add('INSERT');
      }
      i = j;
      continue;
    }

    if (kind === 'DIMENSION') {
      // R12 — DIMENSION wraps an anonymous block (`*D{n}`) by name in code 2.
      // We treat it like an INSERT at the block insertion point (codes 10/20).
      const dim = readDimensionHeader(entityPairs);
      if (dim) {
        const block = blocks.get(dim.blockName);
        if (block) {
          expandBlock(block, dim, blocks, out, 0, unsupported);
        } else {
          unsupported.add(`DIMENSION(${dim.blockName})`);
        }
      } else {
        unsupported.add('DIMENSION');
      }
      i = j;
      continue;
    }

    const entity = readEntity(kind, entityPairs);
    if (entity) {
      out.push(entity);
    } else if (kind !== 'SEQEND' && kind !== 'VERTEX') {
      // SEQEND/VERTEX are consumed by POLYLINE; logging them as unsupported
      // would be noise.
      unsupported.add(kind);
    }
    // POLYLINE has a special wrinkle: after the POLYLINE tag come N VERTEX
    // tags then SEQEND. readPolyline handled the body already if we're here
    // for a plain POLYLINE start; the loop below skips ahead past VERTEX/SEQEND.
    if (kind === 'POLYLINE') {
      const polyResult = readPolylineWithVertices(slice, i);
      if (polyResult.entity) out.push(polyResult.entity);
      i = polyResult.next;
      continue;
    }
    i = j;
  }
}

// ── BLOCKS ────────────────────────────────────────────────────────────────

interface BlockDef {
  name: string;
  basePoint: V2;
  /** Entities that compose the block. Stored in raw form (pre-transform). */
  entities: DxfEntity[];
  /** Nested INSERT references to expand at the use site. */
  inserts: InsertHeader[];
}

interface InsertHeader {
  blockName: string;
  insertion: V2;
  scale: V2;
  /** Degrees, CCW. */
  rotation: number;
  layer: string;
  color: number;
}

function readBlocks(
  slice: CodePair[],
  blocks: Map<string, BlockDef>,
  unsupported: Set<string>,
): void {
  let i = 0;
  while (i < slice.length) {
    const p = slice[i]!;
    if (p.code === 0 && p.value === 'BLOCK') {
      const result = readOneBlock(slice, i + 1, unsupported);
      if (result.block) blocks.set(result.block.name, result.block);
      i = result.next;
      continue;
    }
    i++;
  }
}

function readOneBlock(
  slice: CodePair[],
  from: number,
  unsupported: Set<string>,
): { block: BlockDef | null; next: number } {
  // Header pairs end at the next 0-tag (which is the first entity inside
  // the block — or ENDBLK if the block is empty).
  let j = from;
  while (j < slice.length && slice[j]!.code !== 0) j++;
  const headerPairs = slice.slice(from, j);
  let name = '';
  let bpx = 0;
  let bpy = 0;
  for (const p of headerPairs) {
    if (p.code === 2) name = p.value;
    else if (p.code === 10) bpx = parseFloat(p.value);
    else if (p.code === 20) bpy = parseFloat(p.value);
  }

  const entities: DxfEntity[] = [];
  const inserts: InsertHeader[] = [];

  while (j < slice.length) {
    const p = slice[j]!;
    if (p.code !== 0) {
      j++;
      continue;
    }
    if (p.value === 'ENDBLK') {
      // Skip ENDBLK body to the next entity boundary.
      j++;
      while (j < slice.length && slice[j]!.code !== 0) j++;
      break;
    }
    let k = j + 1;
    while (k < slice.length && slice[k]!.code !== 0) k++;
    const entityPairs = slice.slice(j + 1, k);

    if (p.value === 'INSERT') {
      const ins = readInsertHeader(entityPairs);
      if (ins) inserts.push(ins);
      j = k;
      continue;
    }
    if (p.value === 'POLYLINE') {
      const polyResult = readPolylineWithVertices(slice, j);
      if (polyResult.entity) entities.push(polyResult.entity);
      j = polyResult.next;
      continue;
    }
    const ent = readEntity(p.value, entityPairs);
    if (ent) entities.push(ent);
    else if (p.value !== 'SEQEND' && p.value !== 'VERTEX') {
      unsupported.add(`BLOCK:${p.value}`);
    }
    j = k;
  }

  if (!name) return { block: null, next: j };
  return {
    block: { name, basePoint: { x: bpx, y: bpy }, entities, inserts },
    next: j,
  };
}

/**
 * R12 — DIMENSION boils down to an anonymous-block insertion at the block
 * insertion point. CAD writes a `*D{n}` block under BLOCKS that contains
 * the rendered geometry (lines + arrowheads + text); we just treat the
 * DIMENSION row as an INSERT against that block.
 */
function readDimensionHeader(pairs: CodePair[]): InsertHeader | null {
  const { layer, color } = commonEntityFields(pairs);
  let blockName = '';
  let x = 0;
  let y = 0;
  for (const p of pairs) {
    if (p.code === 2) blockName = p.value;
    else if (p.code === 10) x = parseFloat(p.value);
    else if (p.code === 20) y = parseFloat(p.value);
  }
  if (!blockName) return null;
  return {
    blockName,
    insertion: { x, y },
    scale: { x: 1, y: 1 },
    rotation: 0,
    layer,
    color,
  };
}

function readInsertHeader(pairs: CodePair[]): InsertHeader | null {
  const { layer, color } = commonEntityFields(pairs);
  let blockName = '';
  let x = 0;
  let y = 0;
  let sx = 1;
  let sy = 1;
  let rot = 0;
  for (const p of pairs) {
    if (p.code === 2) blockName = p.value;
    else if (p.code === 10) x = parseFloat(p.value);
    else if (p.code === 20) y = parseFloat(p.value);
    else if (p.code === 41) sx = parseFloat(p.value) || 1;
    else if (p.code === 42) sy = parseFloat(p.value) || 1;
    else if (p.code === 50) rot = parseFloat(p.value) || 0;
  }
  if (!blockName) return null;
  return {
    blockName,
    insertion: { x, y },
    scale: { x: sx, y: sy },
    rotation: rot,
    layer,
    color,
  };
}

const MAX_NESTED_BLOCK_DEPTH = 6;

function expandBlock(
  block: BlockDef,
  insert: InsertHeader,
  blocks: Map<string, BlockDef>,
  out: DxfEntity[],
  depth: number,
  unsupported: Set<string>,
): void {
  if (depth > MAX_NESTED_BLOCK_DEPTH) {
    unsupported.add(`INSERT(nested>${MAX_NESTED_BLOCK_DEPTH})`);
    return;
  }
  const t = {
    base: block.basePoint,
    insertion: insert.insertion,
    scale: insert.scale,
    rotationRad: (insert.rotation * Math.PI) / 180,
  };
  for (const e of block.entities) {
    out.push(transformEntity(e, t, insert));
  }
  for (const nested of block.inserts) {
    const nestedBlock = blocks.get(nested.blockName);
    if (!nestedBlock) {
      unsupported.add(`INSERT(${nested.blockName})`);
      continue;
    }
    // Compose: nested INSERT's transform applies first, then the outer one.
    // Easiest is to build a synthetic InsertHeader whose insertion/scale/
    // rotation already include the outer transform.
    const composed = composeInserts(insert, nested, block.basePoint);
    expandBlock(nestedBlock, composed, blocks, out, depth + 1, unsupported);
  }
}

interface AffineCtx {
  base: V2;
  insertion: V2;
  scale: V2;
  rotationRad: number;
}

function transformPoint(p: V2, t: AffineCtx): V2 {
  // 1) translate from base point to origin, 2) scale, 3) rotate, 4) translate to insertion.
  const dx = (p.x - t.base.x) * t.scale.x;
  const dy = (p.y - t.base.y) * t.scale.y;
  const cos = Math.cos(t.rotationRad);
  const sin = Math.sin(t.rotationRad);
  return {
    x: dx * cos - dy * sin + t.insertion.x,
    y: dx * sin + dy * cos + t.insertion.y,
  };
}

function transformEntity(
  e: DxfEntity,
  t: AffineCtx,
  insert: InsertHeader,
): DxfEntity {
  // Layer/color resolution: ByLayer / ByBlock entities inside a block adopt
  // the INSERT's layer/color so the render bucket reflects "where this came
  // from". Explicit colors keep their value.
  const layer = e.layer && e.layer !== '0' ? e.layer : insert.layer;
  const color = e.color === 256 || e.color === 0 ? insert.color : e.color;
  const meanScale = (Math.abs(t.scale.x) + Math.abs(t.scale.y)) / 2;

  switch (e.kind) {
    case 'line':
      return {
        ...e,
        layer,
        color,
        p1: transformPoint(e.p1, t),
        p2: transformPoint(e.p2, t),
      };
    case 'circle':
      return {
        ...e,
        layer,
        color,
        center: transformPoint(e.center, t),
        // Phase 3 — non-uniform scale would turn this into an ellipse; we
        // approximate with the mean radius.
        radius: e.radius * meanScale,
      };
    case 'arc':
      return {
        ...e,
        layer,
        color,
        center: transformPoint(e.center, t),
        radius: e.radius * meanScale,
        startAngle: e.startAngle + (insert.rotation),
        endAngle: e.endAngle + (insert.rotation),
      };
    case 'polyline':
      return {
        ...e,
        layer,
        color,
        points: e.points.map((p) => transformPoint(p, t)),
      };
    case 'text':
      return {
        ...e,
        layer,
        color,
        position: transformPoint(e.position, t),
        rotation: e.rotation + insert.rotation,
        height: e.height * meanScale,
      };
    case 'hatch':
      return {
        ...e,
        layer,
        color,
        loops: e.loops.map((loop) => loop.map((p) => transformPoint(p, t))),
      };
  }
}

function composeInserts(
  outer: InsertHeader,
  inner: InsertHeader,
  outerBase: V2,
): InsertHeader {
  // Compute the position of `inner.insertion` after the outer transform.
  const t: AffineCtx = {
    base: outerBase,
    insertion: outer.insertion,
    scale: outer.scale,
    rotationRad: (outer.rotation * Math.PI) / 180,
  };
  const composedInsertion = transformPoint(inner.insertion, t);
  return {
    blockName: inner.blockName,
    insertion: composedInsertion,
    scale: {
      x: inner.scale.x * outer.scale.x,
      y: inner.scale.y * outer.scale.y,
    },
    rotation: inner.rotation + outer.rotation,
    layer: inner.layer === '0' ? outer.layer : inner.layer,
    color: inner.color === 256 || inner.color === 0 ? outer.color : inner.color,
  };
}

function readEntity(kind: string, pairs: CodePair[]): DxfEntity | null {
  switch (kind) {
    case 'LINE':
      return readLine(pairs);
    case 'CIRCLE':
      return readCircle(pairs);
    case 'ARC':
      return readArc(pairs);
    case 'LWPOLYLINE':
      return readLwPolyline(pairs);
    case 'TEXT':
      return readText(pairs);
    case 'MTEXT':
      return readMText(pairs);
    case 'HATCH':
      return readHatch(pairs);
    default:
      return null;
  }
}

function commonEntityFields(pairs: CodePair[]): {
  layer: string;
  color: number;
  /** Undefined when group 370 is absent — most fixtures, in which case the
   *  scene builder falls back to a default px width. */
  lineWeight?: number;
} {
  let layer = '0';
  let color = 256; // ByLayer
  let lineWeight: number | undefined;
  for (const p of pairs) {
    if (p.code === 8) layer = p.value;
    else if (p.code === 62) {
      const n = Number.parseInt(p.value, 10);
      if (Number.isFinite(n)) color = n;
    } else if (p.code === 370) {
      // R37 V-2 — DXF group 370 (line weight). Negative values are sentinels
      // (-1=ByLayer, -2=ByBlock, -3=LWDEFAULT); non-negative = 1/100 mm.
      const n = Number.parseInt(p.value, 10);
      if (Number.isFinite(n)) lineWeight = n;
    }
  }
  const out: { layer: string; color: number; lineWeight?: number } = {
    layer,
    color,
  };
  if (lineWeight !== undefined) out.lineWeight = lineWeight;
  return out;
}

function readLine(pairs: CodePair[]): LineEntity | null {
  const { layer, color, lineWeight } = commonEntityFields(pairs);
  let x1 = 0;
  let y1 = 0;
  let x2 = 0;
  let y2 = 0;
  let seen = 0;
  for (const p of pairs) {
    if (p.code === 10) { x1 = parseFloat(p.value); seen |= 1; }
    else if (p.code === 20) { y1 = parseFloat(p.value); seen |= 2; }
    else if (p.code === 11) { x2 = parseFloat(p.value); seen |= 4; }
    else if (p.code === 21) { y2 = parseFloat(p.value); seen |= 8; }
  }
  if (seen !== 0xf) return null;
  const out: LineEntity = {
    kind: 'line',
    layer,
    color,
    p1: { x: x1, y: y1 },
    p2: { x: x2, y: y2 },
  };
  if (lineWeight !== undefined) out.lineWeight = lineWeight;
  return out;
}

function readCircle(pairs: CodePair[]): CircleEntity | null {
  const { layer, color, lineWeight } = commonEntityFields(pairs);
  let cx = NaN;
  let cy = NaN;
  let r = NaN;
  for (const p of pairs) {
    if (p.code === 10) cx = parseFloat(p.value);
    else if (p.code === 20) cy = parseFloat(p.value);
    else if (p.code === 40) r = parseFloat(p.value);
  }
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r <= 0) {
    return null;
  }
  const out: CircleEntity = {
    kind: 'circle',
    layer,
    color,
    center: { x: cx, y: cy },
    radius: r,
  };
  if (lineWeight !== undefined) out.lineWeight = lineWeight;
  return out;
}

function readArc(pairs: CodePair[]): ArcEntity | null {
  const { layer, color, lineWeight } = commonEntityFields(pairs);
  let cx = NaN;
  let cy = NaN;
  let r = NaN;
  let start = NaN;
  let end = NaN;
  for (const p of pairs) {
    if (p.code === 10) cx = parseFloat(p.value);
    else if (p.code === 20) cy = parseFloat(p.value);
    else if (p.code === 40) r = parseFloat(p.value);
    else if (p.code === 50) start = parseFloat(p.value);
    else if (p.code === 51) end = parseFloat(p.value);
  }
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(r) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    r <= 0
  ) {
    return null;
  }
  const out: ArcEntity = {
    kind: 'arc',
    layer,
    color,
    center: { x: cx, y: cy },
    radius: r,
    startAngle: start,
    endAngle: end,
  };
  if (lineWeight !== undefined) out.lineWeight = lineWeight;
  return out;
}

function readText(pairs: CodePair[]): TextEntity | null {
  const { layer, color, lineWeight } = commonEntityFields(pairs);
  let x = NaN;
  let y = NaN;
  let height = NaN;
  let content = '';
  let rotation = 0;
  let hAlign: 0 | 1 | 2 = 0;
  for (const p of pairs) {
    if (p.code === 10) x = parseFloat(p.value);
    else if (p.code === 20) y = parseFloat(p.value);
    else if (p.code === 40) height = parseFloat(p.value);
    else if (p.code === 1) content = p.value;
    else if (p.code === 50) rotation = parseFloat(p.value) || 0;
    else if (p.code === 72) {
      const n = Number.parseInt(p.value, 10) || 0;
      hAlign = n === 1 ? 1 : n === 2 ? 2 : 0;
    }
  }
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(height) ||
    height <= 0 ||
    content.length === 0
  ) {
    return null;
  }
  const out: TextEntity = {
    kind: 'text',
    layer,
    color,
    position: { x, y },
    height,
    rotation,
    content,
    hAlign,
  };
  if (lineWeight !== undefined) out.lineWeight = lineWeight;
  return out;
}

function readMText(pairs: CodePair[]): TextEntity | null {
  const { layer, color, lineWeight } = commonEntityFields(pairs);
  let x = NaN;
  let y = NaN;
  let height = NaN;
  let rotation = 0;
  // MTEXT may split content across one `1` (last chunk) and many `3` chunks
  // (each 250 chars). They appear in document order.
  const chunks: string[] = [];
  for (const p of pairs) {
    if (p.code === 10) x = parseFloat(p.value);
    else if (p.code === 20) y = parseFloat(p.value);
    else if (p.code === 40) height = parseFloat(p.value);
    else if (p.code === 50) rotation = parseFloat(p.value) || 0;
    else if (p.code === 1 || p.code === 3) chunks.push(p.value);
  }
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null;
  }
  // Strip MTEXT inline codes (best-effort): \P → newline, \f...; → drop,
  // \\ → \, {} groups left as-is text. Phase 2 just renders the plain text;
  // styled inline runs ship later if users actually need them.
  const raw = chunks.join('');
  const content = raw
    .replace(/\\P/g, '\n')
    .replace(/\\f[^;]*;/g, '')
    .replace(/\\H[^;]*;/g, '')
    .replace(/\\C\d+;?/g, '')
    .replace(/\\\\/g, '\\')
    .replace(/[{}]/g, '')
    .trim();
  if (content.length === 0) return null;
  const out: TextEntity = {
    kind: 'text',
    layer,
    color,
    position: { x, y },
    height,
    rotation,
    content,
    hAlign: 0,
  };
  if (lineWeight !== undefined) out.lineWeight = lineWeight;
  return out;
}

/**
 * R12 — best-effort HATCH parser. We only handle polyline boundary loops
 * (boundary path type bit 1 set). Edge-defined loops (lines/arcs/ellipses)
 * are skipped — they're rare in field drawings, and supporting them needs a
 * curve-tessellation pass that belongs in a later phase.
 *
 * Solid status comes from group 70: 1 = solid, 0 = pattern.
 *
 * R25 — for pattern hatches we additionally capture group 2 (pattern name),
 * 52 (pattern angle in degrees), and 41 (pattern scale) so the scene builder
 * can render line-segment fills. Pattern fields are advisory; absent values
 * fall through to the renderer's defaults (ANSI31, 0°, scale 1).
 */
function readHatch(pairs: CodePair[]): HatchEntity | null {
  const { layer, color, lineWeight } = commonEntityFields(pairs);
  let solid = false;
  let pathCount = 0;
  let patternName: string | undefined;
  let patternAngle: number | undefined;
  let patternScale: number | undefined;
  // We walk pairs sequentially because path/loop boundaries are positional
  // (the same group code repeats across loops with no parent marker).
  const loops: V2[][] = [];
  let i = 0;
  // Pre-boundary header: collect 70 (solid flag), 2 (pattern name), and locate
  // 91 (boundary path count) which kicks off the loop block. Other codes here
  // (5/100/330/410/8/...) are entity metadata — `commonEntityFields` already
  // grabbed layer/color so we just skip them.
  for (; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 70) solid = (Number.parseInt(p.value, 10) || 0) === 1;
    else if (p.code === 2) patternName = p.value;
    else if (p.code === 91) {
      pathCount = Number.parseInt(p.value, 10) || 0;
      i++;
      break;
    }
  }
  if (pathCount === 0) return null;

  // Now the next `pathCount` paths follow. Each path begins with code 92
  // (boundary path type flags). For polyline boundary (bit 1 set), code 93
  // (vertex count) and then alternating 10/20 vertex coords. We stop the
  // boundary block when we've seen all paths AND we hit code 75 (hatch
  // style) or 76 (hatch pattern type) which always come right after.
  let pathsSeen = 0;
  let pendingX: number | null = null;
  let currentLoop: V2[] | null = null;
  let boundaryEndIdx = i;
  for (; i < pairs.length && pathsSeen < pathCount; i++) {
    const p = pairs[i]!;
    if (p.code === 92) {
      if (currentLoop && currentLoop.length >= 3) loops.push(currentLoop);
      const flags = Number.parseInt(p.value, 10) || 0;
      // Bit 1 = polyline boundary. Edge-defined loops would have bit 1 unset
      // and code 93 would mean edge count instead of vertex count.
      const isPolyline = (flags & 2) === 2;
      currentLoop = isPolyline ? [] : null;
      pathsSeen++;
      pendingX = null;
      continue;
    }
    if (currentLoop === null) continue;
    if (p.code === 10) {
      pendingX = parseFloat(p.value);
    } else if (p.code === 20 && pendingX !== null) {
      const y = parseFloat(p.value);
      if (Number.isFinite(pendingX) && Number.isFinite(y)) {
        currentLoop.push({ x: pendingX, y });
      }
      pendingX = null;
    } else if (p.code === 75 || p.code === 76) {
      // End of boundary block — these come immediately after the last path.
      boundaryEndIdx = i;
      break;
    }
  }
  if (currentLoop && currentLoop.length >= 3) loops.push(currentLoop);
  if (boundaryEndIdx === 0) boundaryEndIdx = i;

  // R25 — pattern definition tail. Codes after the boundary block include
  // 52 (pattern angle, degrees) and 41 (pattern scale). These only matter
  // for non-solid hatches; we always sweep so the parser stays defensive
  // against writer-specific orderings.
  for (let k = boundaryEndIdx; k < pairs.length; k++) {
    const p = pairs[k]!;
    if (p.code === 52) {
      const v = parseFloat(p.value);
      if (Number.isFinite(v)) patternAngle = v;
    } else if (p.code === 41) {
      const v = parseFloat(p.value);
      if (Number.isFinite(v) && v !== 0) patternScale = v;
    }
  }

  if (loops.length === 0) return null;
  const out: HatchEntity = { kind: 'hatch', layer, color, loops, solid };
  if (patternName !== undefined) out.patternName = patternName;
  if (patternAngle !== undefined) out.patternAngle = patternAngle;
  if (patternScale !== undefined) out.patternScale = patternScale;
  if (lineWeight !== undefined) out.lineWeight = lineWeight;
  return out;
}

function readLwPolyline(pairs: CodePair[]): PolylineEntity | null {
  const { layer, color, lineWeight } = commonEntityFields(pairs);
  let closed = false;
  const pts: V2[] = [];
  let pendingX: number | null = null;
  for (const p of pairs) {
    if (p.code === 70) {
      const flags = Number.parseInt(p.value, 10) || 0;
      closed = (flags & 1) === 1;
    } else if (p.code === 10) {
      // LWPOLYLINE vertices come as alternating 10/20 pairs in document
      // order. Collect X first, then 20 closes the point.
      pendingX = parseFloat(p.value);
    } else if (p.code === 20) {
      const y = parseFloat(p.value);
      if (pendingX != null && Number.isFinite(pendingX) && Number.isFinite(y)) {
        pts.push({ x: pendingX, y });
      }
      pendingX = null;
    }
  }
  if (pts.length < 2) return null;
  const out: PolylineEntity = {
    kind: 'polyline',
    layer,
    color,
    points: pts,
    closed,
  };
  if (lineWeight !== undefined) out.lineWeight = lineWeight;
  return out;
}

/**
 * Legacy `POLYLINE` is followed by N `VERTEX` entries and a `SEQEND`. The
 * outer loop in readEntities() can't bundle them into a single slice (they're
 * separated by 0-tags), so we handle the whole sequence here and return where
 * to resume scanning.
 */
function readPolylineWithVertices(
  slice: CodePair[],
  startIdx: number,
): { entity: PolylineEntity | null; next: number } {
  // First, find the body of the POLYLINE header (slice pairs between
  // startIdx+1 and the next 0-tag).
  let j = startIdx + 1;
  while (j < slice.length && slice[j]!.code !== 0) j++;
  const headerPairs = slice.slice(startIdx + 1, j);
  const { layer, color, lineWeight } = commonEntityFields(headerPairs);
  let flags = 0;
  for (const p of headerPairs) {
    if (p.code === 70) flags = Number.parseInt(p.value, 10) || 0;
  }
  const closed = (flags & 1) === 1;

  const pts: V2[] = [];
  // Walk subsequent VERTEX entries until SEQEND.
  while (j < slice.length) {
    const p = slice[j]!;
    if (p.code !== 0) {
      j++;
      continue;
    }
    if (p.value === 'SEQEND') {
      // Skip past SEQEND's body to the next entity boundary.
      j++;
      while (j < slice.length && slice[j]!.code !== 0) j++;
      break;
    }
    if (p.value === 'VERTEX') {
      let k = j + 1;
      let x = NaN;
      let y = NaN;
      while (k < slice.length && slice[k]!.code !== 0) {
        const v = slice[k]!;
        if (v.code === 10) x = parseFloat(v.value);
        else if (v.code === 20) y = parseFloat(v.value);
        k++;
      }
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
      j = k;
      continue;
    }
    // Some other entity slipped in (malformed DXF). Bail out — the outer
    // loop will resume from `j` and re-dispatch.
    break;
  }

  if (pts.length < 2) {
    return { entity: null, next: j };
  }
  const entity: PolylineEntity = {
    kind: 'polyline',
    layer,
    color,
    points: pts,
    closed,
  };
  if (lineWeight !== undefined) entity.lineWeight = lineWeight;
  return { entity, next: j };
}
