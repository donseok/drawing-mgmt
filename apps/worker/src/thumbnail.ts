/**
 * Thumbnail generator (R29 V-INF-6).
 *
 * Produces a 256×256 PNG preview from the conversion artifacts. Strategy:
 *
 *   1. If a PDF path is supplied, we currently SKIP — sharp (libvips) does not
 *      ship with reliable PDF support across platforms, and the obvious
 *      candidates (poppler, mupdf) are GPL/AGPL. Adding them would either
 *      break our GPL isolation policy or require another subprocess. PDF →
 *      thumbnail is tracked as a follow-up and will live next to LibreDWG
 *      (subprocess only).
 *
 *   2. If a DXF path is supplied, we parse the ENTITIES section with a tiny
 *      in-process reader (LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC),
 *      compute the bounding box, render an SVG, and rasterize via sharp.
 *      Other entities are skipped — the thumbnail is intentionally a rough
 *      preview, not an authoritative render.
 *
 *   3. If both inputs are missing or the parser produces no drawable
 *      geometry, we return `{ success: false, reason }`. The caller treats
 *      this as a graceful skip and leaves `thumbnailPath` unset.
 *
 * No GPL dependencies are introduced. sharp is MIT.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export interface ThumbnailInput {
  /** Absolute path to a DXF file (preferred — produces an outline preview). */
  dxfPath?: string;
  /** Absolute path to a PDF file. Currently unused — see file header. */
  pdfPath?: string;
}

export interface ThumbnailResult {
  success: boolean;
  /** Diagnostic only when `success === false`. */
  reason?: string;
}

/** Final canvas dimensions. fit=inside, white background. */
const CANVAS = 256;
/** Inner padding so geometry doesn't kiss the edges. */
const PADDING = 8;
/** Stroke width in screen pixels. */
const STROKE = 1.0;
/** Hard cap on segments rendered into the SVG (keeps file size sane). */
const MAX_SEGMENTS = 50_000;
/** Number of straight-line segments used to approximate a full circle. */
const CIRCLE_SEGMENTS = 64;

/**
 * Render a thumbnail PNG to `outPath`. Returns `{ success: true }` on success
 * and `{ success: false, reason }` on graceful skip. Throws only for unknown
 * I/O errors when writing the output (everything else is recovered into a
 * skip result).
 */
export async function generateThumbnail(
  input: ThumbnailInput,
  outPath: string,
): Promise<ThumbnailResult> {
  // Strategy 1: DXF outline. Strategy 2 (PDF) is intentionally a no-op for
  // now — see file header.
  if (input.dxfPath) {
    try {
      const dxfText = await fs.readFile(input.dxfPath, 'utf8');
      const segments = parseDxfSegments(dxfText);
      if (segments.length === 0) {
        return { success: false, reason: 'no-drawable-entities' };
      }

      const svg = segmentsToSvg(segments);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await sharp(Buffer.from(svg, 'utf8'), { density: 96 })
        .resize(CANVAS, CANVAS, { fit: 'inside', background: '#ffffff' })
        .flatten({ background: '#ffffff' })
        .png({ compressionLevel: 9 })
        .toFile(outPath);
      return { success: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { success: false, reason: `dxf-thumbnail-failed: ${reason}` };
    }
  }

  if (input.pdfPath) {
    // PDF path is reserved for future work — see header comment.
    return { success: false, reason: 'pdf-thumbnail-not-implemented' };
  }

  return { success: false, reason: 'no-input-provided' };
}

// ───────────────────────────────────────────────────────────────────────────
// DXF parsing — tiny ENTITIES reader
// ───────────────────────────────────────────────────────────────────────────

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Walk an ASCII DXF file and emit straight-line segments for the entity
 * kinds we care about. Anything we don't recognize is silently skipped. The
 * goal is a recognizable preview, not a full render — see DwgViewer for the
 * authoritative path.
 */
function parseDxfSegments(text: string): Segment[] {
  // DXF group code/value pairs come in pairs of consecutive lines:
  //   <code>\n<value>\n
  // We split once and walk the array two at a time.
  const lines = text.split(/\r?\n/);
  const out: Segment[] = [];

  // Locate the ENTITIES section. DXF files can also place entities inside
  // BLOCKS, but for thumbnails the ENTITIES section is sufficient and
  // skipping BLOCKS avoids INSERT-resolution complexity.
  let i = findSection(lines, 'ENTITIES');
  if (i < 0) return out;

  while (i < lines.length - 1) {
    const code = (lines[i] ?? '').trim();
    const value = (lines[i + 1] ?? '').trim();
    if (code === '0' && value === 'ENDSEC') break;
    if (code === '0') {
      const consumed = parseEntity(lines, i, out);
      if (consumed > 0) {
        i += consumed;
        continue;
      }
    }
    i += 2;
    if (out.length >= MAX_SEGMENTS) break;
  }

  return out;
}

/**
 * Find the line index *after* the `0 SECTION` / `2 <name>` header for the
 * named section. Returns -1 if missing.
 */
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

/**
 * Parse one entity starting at `lines[i]` (which is the group code "0"
 * line). Pushes resulting segments onto `out`. Returns the number of lines
 * consumed (always even; 0 means "not a kind we handle, caller should skip
 * by 2").
 */
function parseEntity(
  lines: readonly string[],
  startIdx: number,
  out: Segment[],
): number {
  const kind = (lines[startIdx + 1] ?? '').trim();

  // Slurp group-code/value pairs until the next "0 ..." sentinel.
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

  switch (kind) {
    case 'LINE':
      addLine(fields, out);
      return consumed;
    case 'LWPOLYLINE':
    case 'POLYLINE':
      addPolyline(fields, out, kind === 'LWPOLYLINE');
      return consumed;
    case 'CIRCLE':
      addCircle(fields, out);
      return consumed;
    case 'ARC':
      addArc(fields, out);
      return consumed;
    default:
      return consumed;
  }
}

function num(fields: Map<number, string[]>, code: number, fallback = 0): number {
  const v = fields.get(code)?.[0];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function addLine(fields: Map<number, string[]>, out: Segment[]): void {
  const x1 = num(fields, 10);
  const y1 = num(fields, 20);
  const x2 = num(fields, 11);
  const y2 = num(fields, 21);
  if (
    Number.isFinite(x1) &&
    Number.isFinite(y1) &&
    Number.isFinite(x2) &&
    Number.isFinite(y2)
  ) {
    out.push({ x1, y1, x2, y2 });
  }
}

function addPolyline(
  fields: Map<number, string[]>,
  out: Segment[],
  isLW: boolean,
): void {
  const xs = (fields.get(10) ?? []).map(Number);
  const ys = (fields.get(20) ?? []).map(Number);
  // closed flag: LWPOLYLINE uses bit 1 of group 70; POLYLINE same.
  const flag = num(fields, 70);
  const closed = (flag & 1) === 1;
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return;
  for (let k = 0; k < n - 1; k++) {
    out.push({ x1: xs[k]!, y1: ys[k]!, x2: xs[k + 1]!, y2: ys[k + 1]! });
  }
  if (closed && n > 2) {
    out.push({
      x1: xs[n - 1]!,
      y1: ys[n - 1]!,
      x2: xs[0]!,
      y2: ys[0]!,
    });
  }
  // (LW)POLYLINE bulge segments are ignored — straight chord is fine for a
  // thumbnail. POLYLINE entities also include trailing VERTEX/SEQEND
  // entities that the parser will simply skip.
  void isLW;
}

function addCircle(fields: Map<number, string[]>, out: Segment[]): void {
  const cx = num(fields, 10);
  const cy = num(fields, 20);
  const r = num(fields, 40);
  if (!Number.isFinite(r) || r <= 0) return;
  approximateArc(cx, cy, r, 0, Math.PI * 2, CIRCLE_SEGMENTS, out);
}

function addArc(fields: Map<number, string[]>, out: Segment[]): void {
  const cx = num(fields, 10);
  const cy = num(fields, 20);
  const r = num(fields, 40);
  // DXF angles are in degrees, CCW from +X.
  const startDeg = num(fields, 50);
  const endDeg = num(fields, 51);
  if (!Number.isFinite(r) || r <= 0) return;

  let s = (startDeg * Math.PI) / 180;
  let e = (endDeg * Math.PI) / 180;
  // Normalize so end > start.
  while (e < s) e += Math.PI * 2;
  const sweep = e - s;
  // Scale segment count by sweep so a 5° arc doesn't get 64 segments.
  const segs = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * CIRCLE_SEGMENTS));
  approximateArc(cx, cy, r, s, e, segs, out);
}

function approximateArc(
  cx: number,
  cy: number,
  r: number,
  startRad: number,
  endRad: number,
  segs: number,
  out: Segment[],
): void {
  const step = (endRad - startRad) / segs;
  let prevX = cx + Math.cos(startRad) * r;
  let prevY = cy + Math.sin(startRad) * r;
  for (let k = 1; k <= segs; k++) {
    const a = startRad + step * k;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    out.push({ x1: prevX, y1: prevY, x2: x, y2: y });
    prevX = x;
    prevY = y;
    if (out.length >= MAX_SEGMENTS) return;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// SVG rendering
// ───────────────────────────────────────────────────────────────────────────

/**
 * Convert a list of model-space segments into an SVG document framed at
 * `CANVAS` × `CANVAS`. The SVG flips Y so DXF (Y-up) renders the way an
 * AutoCAD operator expects.
 */
function segmentsToSvg(segments: readonly Segment[]): string {
  // Bounding box.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segments) {
    if (s.x1 < minX) minX = s.x1;
    if (s.y1 < minY) minY = s.y1;
    if (s.x2 < minX) minX = s.x2;
    if (s.y2 < minY) minY = s.y2;
    if (s.x1 > maxX) maxX = s.x1;
    if (s.y1 > maxY) maxY = s.y1;
    if (s.x2 > maxX) maxX = s.x2;
    if (s.y2 > maxY) maxY = s.y2;
  }
  const width = Math.max(1e-6, maxX - minX);
  const height = Math.max(1e-6, maxY - minY);

  const drawable = CANVAS - PADDING * 2;
  const scale = Math.min(drawable / width, drawable / height);

  // Center the geometry inside the canvas.
  const offX = PADDING + (drawable - width * scale) / 2 - minX * scale;
  // Y is flipped: SVG Y grows down, DXF Y grows up.
  const offY = PADDING + (drawable - height * scale) / 2 + maxY * scale;

  const lines: string[] = [];
  for (const s of segments) {
    const x1 = (s.x1 * scale + offX).toFixed(2);
    const y1 = (offY - s.y1 * scale).toFixed(2);
    const x2 = (s.x2 * scale + offX).toFixed(2);
    const y2 = (offY - s.y2 * scale).toFixed(2);
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}">`,
    `<rect width="${CANVAS}" height="${CANVAS}" fill="#ffffff"/>`,
    `<g stroke="#1f2937" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" fill="none">`,
    lines.join(''),
    `</g>`,
    `</svg>`,
  ].join('');
}
