/**
 * R31 P-1 — DXF → PDF generator.
 *
 * pdf-lib (MIT) only. No GPL/AGPL deps. The mapper handles the same Phase 1
 * entity set the in-house DXF viewer (apps/web/lib/dxf-parser) handles —
 * LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE — plus a tiny ACI palette so the
 * `color-a3` CTB can pass colors through. Anything else (HATCH, INSERT,
 * TEXT, MTEXT, SPLINE, ELLIPSE, …) is silently skipped — Phase 2.
 *
 * Strategy chosen by viewer-engineer:
 *   - DXF text → minimal in-process parser (same shape as thumbnail.ts but
 *     captures color/layer too)
 *   - bbox computed from the entity geometry; we ignore HEADER $EXTMIN/MAX
 *     because legacy AutoCAD writes them stale or as 1e20 sentinels often
 *     enough to be unreliable.
 *   - pdf-lib `PDFPage.draw{Line,Circle,SvgPath}` calls per entity. Arcs and
 *     polyline closures decompose into svg path strings since pdf-lib has
 *     no native arc primitive.
 *   - CTB:
 *       mono     → all entities forced to black (0,0,0).
 *       color-a3 → ACI 1..9 mapped to named RGB; everything else falls back
 *                  to a deterministic golden-angle hue (matches the viewer's
 *                  aci-colors.ts so on-screen and on-paper stay consistent).
 *   - Page sizes (pdf-lib points): A4 = 595×842, A3 = 842×1191.
 *   - Fit-into-page with a 20mm margin on every edge, preserving aspect.
 *
 * Errors:
 *   - Parsing problems are recovered into a skip ("no drawable geometry"
 *     when nothing useful was found) so the worker can mark the job
 *     FAILED with a helpful message rather than crash.
 *   - `generatePdfFromDxf` only throws for catastrophic pdf-lib failures,
 *     which the worker translates into a row update + BullMQ retry.
 */

import { promises as fs } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';

// ───────────────────────────────────────────────────────────────────────────
// Public surface
// ───────────────────────────────────────────────────────────────────────────

export type PdfCtb = 'mono' | 'color-a3';
export type PdfPageSize = 'A4' | 'A3';

export interface GeneratePdfOptions {
  ctb: PdfCtb;
  pageSize: PdfPageSize;
}

export interface GeneratePdfResult {
  pdf: Buffer;
  /** Number of entity primitives that landed on the page. 0 → caller may treat as failure. */
  entityCount: number;
  /** Names of DXF entity kinds we saw but skipped (HATCH, INSERT, etc). */
  skippedKinds: string[];
}

/**
 * Render `dxfPath` into a PDF buffer using `opts`. Reads the file, parses
 * the ENTITIES section, and emits a single-page PDF. Returns the buffer
 * plus a small report.
 *
 * Throws on pdf-lib failures or unreadable files. Returns `entityCount=0`
 * when the file parsed but contained no drawable Phase 1 entities — the
 * worker treats that as a soft skip.
 */
export async function generatePdfFromDxf(
  dxfPath: string,
  opts: GeneratePdfOptions,
): Promise<GeneratePdfResult> {
  const dxfText = await fs.readFile(dxfPath, 'utf8');
  const parsed = parseDxfEntities(dxfText);

  const pdf = await PDFDocument.create();
  pdf.setTitle('drawing-mgmt print export');
  pdf.setProducer('drawing-mgmt worker (pdf-lib)');

  const [pageW, pageH] = pageSizePoints(opts.pageSize);
  const page = pdf.addPage([pageW, pageH]);

  // 20mm margin in points: 1mm ≈ 2.8346 pt.
  const marginPt = 20 * 2.8346456693;
  const drawableW = pageW - marginPt * 2;
  const drawableH = pageH - marginPt * 2;

  let entityCount = 0;
  if (parsed.entities.length > 0) {
    const bbox = computeBoundingBox(parsed.entities);
    const modelW = Math.max(1e-6, bbox.maxX - bbox.minX);
    const modelH = Math.max(1e-6, bbox.maxY - bbox.minY);
    const scale = Math.min(drawableW / modelW, drawableH / modelH);

    // Center geometry inside the drawable area. PDF Y grows up (same as DXF),
    // so no flip is needed — just shift.
    const offsetX = marginPt + (drawableW - modelW * scale) / 2 - bbox.minX * scale;
    const offsetY = marginPt + (drawableH - modelH * scale) / 2 - bbox.minY * scale;

    const layerColors = parsed.layerColors;

    for (const entity of parsed.entities) {
      const colorVec = resolveColor(entity, layerColors, opts.ctb);
      const drew = drawEntity(page, entity, scale, offsetX, offsetY, colorVec);
      if (drew) entityCount++;
    }
  }

  const bytes = await pdf.save();
  return {
    pdf: Buffer.from(bytes),
    entityCount,
    skippedKinds: parsed.skippedKinds,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Page sizes (pdf-lib uses PostScript points, 72pt = 1in)
// ───────────────────────────────────────────────────────────────────────────

function pageSizePoints(size: PdfPageSize): [number, number] {
  switch (size) {
    case 'A4':
      return [595, 842];
    case 'A3':
      return [842, 1191];
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Color resolution — ACI → pdf-lib RGB
// ───────────────────────────────────────────────────────────────────────────

interface ColorVec {
  r: number;
  g: number;
  b: number;
}

const BLACK: ColorVec = { r: 0, g: 0, b: 0 };

const ACI_NAMED: Record<number, ColorVec> = {
  1: { r: 1, g: 0, b: 0 }, // red
  2: { r: 1, g: 1, b: 0 }, // yellow
  3: { r: 0, g: 1, b: 0 }, // green
  4: { r: 0, g: 1, b: 1 }, // cyan
  5: { r: 0, g: 0, b: 1 }, // blue
  6: { r: 1, g: 0, b: 1 }, // magenta
  7: { r: 0, g: 0, b: 0 }, // black/white — pick black for paper
  8: { r: 0.5, g: 0.5, b: 0.5 },
  9: { r: 0.75, g: 0.75, b: 0.75 },
};

const ACI_BY_BLOCK = 0;
const ACI_BY_LAYER = 256;

function aciToRgbVec(index: number): ColorVec {
  if (index === ACI_BY_BLOCK || index === ACI_BY_LAYER) return BLACK;
  const named = ACI_NAMED[index];
  if (named) return named;
  // Same golden-angle deterministic fallback the viewer uses (aci-colors.ts).
  const hue = (index * 137.508) % 360;
  return hsvToRgbVec(hue, 0.55, 0.55);
}

function hsvToRgbVec(h: number, s: number, v: number): ColorVec {
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c; g = x; b = 0;
  } else if (hp < 2) {
    r = x; g = c; b = 0;
  } else if (hp < 3) {
    r = 0; g = c; b = x;
  } else if (hp < 4) {
    r = 0; g = x; b = c;
  } else if (hp < 5) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  const m = v - c;
  return { r: r + m, g: g + m, b: b + m };
}

function resolveColor(
  entity: ParsedEntity,
  layerColors: Map<string, number>,
  ctb: PdfCtb,
): ColorVec {
  if (ctb === 'mono') return BLACK;
  // color-a3: walk the standard "ByLayer" lookup so layered drawings
  // render their layer color rather than collapsing to black.
  let aci = entity.color;
  if (aci === ACI_BY_LAYER) {
    const layerColor = layerColors.get(entity.layer);
    if (typeof layerColor === 'number') aci = layerColor;
  }
  return aciToRgbVec(aci);
}

// ───────────────────────────────────────────────────────────────────────────
// Entity drawing (pdf-lib calls)
// ───────────────────────────────────────────────────────────────────────────

type PDFPage = ReturnType<PDFDocument['addPage']>;

const STROKE_WIDTH = 0.5; // points — thin enough not to fatten complex drawings

function drawEntity(
  page: PDFPage,
  entity: ParsedEntity,
  scale: number,
  offsetX: number,
  offsetY: number,
  color: ColorVec,
): boolean {
  const strokeColor = rgb(color.r, color.g, color.b);
  const opts = { color: strokeColor, thickness: STROKE_WIDTH };

  switch (entity.kind) {
    case 'line': {
      page.drawLine({
        start: { x: entity.x1 * scale + offsetX, y: entity.y1 * scale + offsetY },
        end: { x: entity.x2 * scale + offsetX, y: entity.y2 * scale + offsetY },
        ...opts,
      });
      return true;
    }
    case 'circle': {
      // pdf-lib's drawCircle strokes a filled circle by default; pass borderColor
      // and skip fill color so we get an unfilled outline.
      page.drawCircle({
        x: entity.cx * scale + offsetX,
        y: entity.cy * scale + offsetY,
        size: entity.r * scale,
        borderColor: strokeColor,
        borderWidth: STROKE_WIDTH,
      });
      return true;
    }
    case 'arc': {
      const path = arcToSvgPath(entity, scale, offsetX, offsetY);
      if (!path) return false;
      page.drawSvgPath(path, {
        borderColor: strokeColor,
        borderWidth: STROKE_WIDTH,
      });
      return true;
    }
    case 'polyline': {
      if (entity.points.length < 2) return false;
      let drewAny = false;
      for (let i = 0; i < entity.points.length - 1; i++) {
        const a = entity.points[i]!;
        const b = entity.points[i + 1]!;
        page.drawLine({
          start: { x: a.x * scale + offsetX, y: a.y * scale + offsetY },
          end: { x: b.x * scale + offsetX, y: b.y * scale + offsetY },
          ...opts,
        });
        drewAny = true;
      }
      if (entity.closed && entity.points.length > 2) {
        const last = entity.points[entity.points.length - 1]!;
        const first = entity.points[0]!;
        page.drawLine({
          start: { x: last.x * scale + offsetX, y: last.y * scale + offsetY },
          end: { x: first.x * scale + offsetX, y: first.y * scale + offsetY },
          ...opts,
        });
      }
      return drewAny;
    }
  }
}

/**
 * Build an SVG path string for a DXF arc, transformed into PDF page space.
 *
 * pdf-lib's drawSvgPath consumes standard SVG `M…A…` commands. SVG arcs use
 * end-points (rx,ry,xrot,large,sweep,x,y) so we compute the start/end
 * coordinates ourselves.
 *
 * IMPORTANT: pdf-lib's SVG path parser inverts Y by default to match its
 * "Y grows up" coordinate system (same as DXF/PDF), so passing pre-flipped
 * coordinates is wrong. We pass DXF-Y-up directly.
 *
 * For full circles (sweep ≥ 360°) we degenerate into two semicircle arcs
 * because SVG's elliptical arc command can't draw a full circle in one go.
 */
function arcToSvgPath(
  entity: ParsedArc,
  scale: number,
  offsetX: number,
  offsetY: number,
): string | undefined {
  if (!Number.isFinite(entity.r) || entity.r <= 0) return undefined;

  const startRad = (entity.startDeg * Math.PI) / 180;
  let endRad = (entity.endDeg * Math.PI) / 180;
  while (endRad <= startRad) endRad += Math.PI * 2;
  let sweep = endRad - startRad;
  if (sweep <= 0) return undefined;

  // Cap absurd sweeps just shy of 2π so we don't degenerate the SVG arc.
  if (sweep >= Math.PI * 2 - 1e-6) {
    sweep = Math.PI * 2 - 1e-6;
    endRad = startRad + sweep;
  }

  const sx = entity.cx + Math.cos(startRad) * entity.r;
  const sy = entity.cy + Math.sin(startRad) * entity.r;
  const ex = entity.cx + Math.cos(endRad) * entity.r;
  const ey = entity.cy + Math.sin(endRad) * entity.r;

  const sxP = sx * scale + offsetX;
  const syP = sy * scale + offsetY;
  const exP = ex * scale + offsetX;
  const eyP = ey * scale + offsetY;
  const rP = entity.r * scale;

  const largeArc = sweep > Math.PI ? 1 : 0;
  // DXF arcs are CCW; SVG sweep=1 means "in the positive-angle direction"
  // which, with PDF's y-up axis, is also CCW. So sweep=1.
  const sweepFlag = 1;

  return `M ${sxP} ${syP} A ${rP} ${rP} 0 ${largeArc} ${sweepFlag} ${exP} ${eyP}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Bounding box
// ───────────────────────────────────────────────────────────────────────────

interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function computeBoundingBox(entities: readonly ParsedEntity[]): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const expand = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const e of entities) {
    switch (e.kind) {
      case 'line':
        expand(e.x1, e.y1);
        expand(e.x2, e.y2);
        break;
      case 'circle':
        expand(e.cx - e.r, e.cy - e.r);
        expand(e.cx + e.r, e.cy + e.r);
        break;
      case 'arc':
        // Use the bounding box of the full circle — over-estimates but fine
        // for fit-to-page; computing the exact arc bbox with quadrant tests
        // adds noise without changing the visual result here.
        expand(e.cx - e.r, e.cy - e.r);
        expand(e.cx + e.r, e.cy + e.r);
        break;
      case 'polyline':
        for (const p of e.points) expand(p.x, p.y);
        break;
    }
  }

  if (!Number.isFinite(minX)) {
    // No expandable geometry — return a unit box so the caller doesn't div0.
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }
  return { minX, minY, maxX, maxY };
}

// ───────────────────────────────────────────────────────────────────────────
// Inline DXF parser (LINE / CIRCLE / ARC / LWPOLYLINE / POLYLINE+VERTEX)
//
// Mirrors thumbnail.ts but additionally captures `color` (group 62) and
// `layer` (group 8) per entity, plus a layer→ACI map from the TABLES section
// so ByLayer entities resolve correctly under the color-a3 CTB.
// ───────────────────────────────────────────────────────────────────────────

interface ParsedLine {
  kind: 'line';
  layer: string;
  color: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ParsedCircle {
  kind: 'circle';
  layer: string;
  color: number;
  cx: number;
  cy: number;
  r: number;
}

interface ParsedArc {
  kind: 'arc';
  layer: string;
  color: number;
  cx: number;
  cy: number;
  r: number;
  startDeg: number;
  endDeg: number;
}

interface ParsedPolyline {
  kind: 'polyline';
  layer: string;
  color: number;
  points: { x: number; y: number }[];
  closed: boolean;
}

type ParsedEntity = ParsedLine | ParsedCircle | ParsedArc | ParsedPolyline;

interface ParsedDxf {
  entities: ParsedEntity[];
  /** layer name → ACI (group 62 of the LAYER table entry). */
  layerColors: Map<string, number>;
  skippedKinds: string[];
}

/** Hard cap on entities — large drawings still produce tractable PDFs. */
const MAX_ENTITIES = 200_000;

function parseDxfEntities(text: string): ParsedDxf {
  const lines = text.split(/\r?\n/);
  const entities: ParsedEntity[] = [];
  const layerColors = new Map<string, number>();
  const skippedKinds = new Set<string>();

  // Pass 1: parse TABLES → LAYER entries for the ByLayer color lookup.
  parseLayerTable(lines, layerColors);

  // Pass 2: walk ENTITIES.
  let i = findSection(lines, 'ENTITIES');
  if (i < 0) {
    return { entities, layerColors, skippedKinds: [] };
  }

  while (i < lines.length - 1 && entities.length < MAX_ENTITIES) {
    const code = (lines[i] ?? '').trim();
    const value = (lines[i + 1] ?? '').trim();
    if (code === '0' && value === 'ENDSEC') break;
    if (code === '0') {
      const consumed = parseEntity(lines, i, value, entities, skippedKinds);
      if (consumed > 0) {
        i += consumed;
        continue;
      }
    }
    i += 2;
  }

  return { entities, layerColors, skippedKinds: [...skippedKinds] };
}

function parseLayerTable(
  lines: readonly string[],
  out: Map<string, number>,
): void {
  // TABLES section can contain multiple TABLE blocks (LAYER, LTYPE, STYLE…).
  // We walk pairs and look for `0 LAYER` entries.
  const tablesStart = findSection(lines, 'TABLES');
  if (tablesStart < 0) return;

  let i = tablesStart;
  while (i < lines.length - 1) {
    const code = (lines[i] ?? '').trim();
    const value = (lines[i + 1] ?? '').trim();
    if (code === '0' && value === 'ENDSEC') break;
    if (code === '0' && value === 'LAYER') {
      // Slurp the LAYER's group codes until the next 0-tag.
      let j = i + 2;
      let name: string | undefined;
      let color: number | undefined;
      while (j < lines.length - 1) {
        const innerCode = (lines[j] ?? '').trim();
        if (innerCode === '0') break;
        const innerValue = (lines[j + 1] ?? '').trim();
        if (innerCode === '2') name = innerValue;
        else if (innerCode === '62') {
          const n = Number(innerValue);
          if (Number.isFinite(n)) color = Math.abs(n); // negative = layer off
        }
        j += 2;
      }
      if (name && color !== undefined) out.set(name, color);
      i = j;
      continue;
    }
    i += 2;
  }
}

function findSection(lines: readonly string[], name: string): number {
  for (let i = 0; i < lines.length - 3; i += 2) {
    if (
      (lines[i] ?? '').trim() === '0' &&
      (lines[i + 1] ?? '').trim() === 'SECTION' &&
      (lines[i + 2] ?? '').trim() === '2' &&
      (lines[i + 3] ?? '').trim() === name
    ) {
      return i + 4;
    }
  }
  return -1;
}

function parseEntity(
  lines: readonly string[],
  startIdx: number,
  kind: string,
  out: ParsedEntity[],
  skipped: Set<string>,
): number {
  // Slurp pairs until next `0 …` tag.
  const fields = new Map<number, string[]>();
  let j = startIdx + 2;
  while (j < lines.length - 1) {
    const code = (lines[j] ?? '').trim();
    if (code === '0') break;
    const codeNum = Number(code);
    const value = (lines[j + 1] ?? '').trim();
    if (Number.isFinite(codeNum)) {
      const list = fields.get(codeNum);
      if (list) list.push(value);
      else fields.set(codeNum, [value]);
    }
    j += 2;
  }
  const consumed = j - startIdx;

  const layer = fields.get(8)?.[0] ?? '0';
  const colorRaw = fields.get(62)?.[0];
  const color = colorRaw !== undefined && Number.isFinite(Number(colorRaw))
    ? Number(colorRaw)
    : ACI_BY_LAYER;

  switch (kind) {
    case 'LINE':
      out.push({
        kind: 'line',
        layer,
        color,
        x1: num(fields, 10),
        y1: num(fields, 20),
        x2: num(fields, 11),
        y2: num(fields, 21),
      });
      return consumed;
    case 'CIRCLE': {
      const r = num(fields, 40);
      if (r > 0) {
        out.push({
          kind: 'circle',
          layer,
          color,
          cx: num(fields, 10),
          cy: num(fields, 20),
          r,
        });
      }
      return consumed;
    }
    case 'ARC': {
      const r = num(fields, 40);
      if (r > 0) {
        out.push({
          kind: 'arc',
          layer,
          color,
          cx: num(fields, 10),
          cy: num(fields, 20),
          r,
          startDeg: num(fields, 50),
          endDeg: num(fields, 51),
        });
      }
      return consumed;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      // Both encode the closed flag in group 70 bit 1.
      const flag = num(fields, 70);
      const closed = (flag & 1) === 1;
      const xs = (fields.get(10) ?? []).map(Number).filter(Number.isFinite);
      const ys = (fields.get(20) ?? []).map(Number).filter(Number.isFinite);
      const n = Math.min(xs.length, ys.length);
      if (n >= 2) {
        const points: { x: number; y: number }[] = [];
        for (let k = 0; k < n; k++) {
          points.push({ x: xs[k]!, y: ys[k]!});
        }
        out.push({ kind: 'polyline', layer, color, points, closed });
      }
      // Old-style POLYLINE may follow with VERTEX entities; we ignore them
      // and rely on group 10/20 lists, which works for LWPOLYLINE and
      // partially for POLYLINE. Full VERTEX walk is a Phase 2 enhancement.
      return consumed;
    }
    default:
      skipped.add(kind);
      return consumed;
  }
}

function num(fields: Map<number, string[]>, code: number, fallback = 0): number {
  const v = fields.get(code)?.[0];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
