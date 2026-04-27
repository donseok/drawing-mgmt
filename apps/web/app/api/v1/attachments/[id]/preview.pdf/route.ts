/**
 * GET /api/v1/attachments/[id]/preview.pdf
 *
 * PDF preview produced by the conversion worker (DWG → PDF). Reads from
 * `${FILE_STORAGE_ROOT}/<id>/preview.pdf` if present, else 404.
 *
 * Mirrors preview.dxf so the viewer's HEAD probe (previewExists) reliably
 * returns 200 when the conversion pipeline (or seed-preview script) has put
 * a file in place.
 *
 * Range request support: PDF.js streams large files via HTTP Range. We honor
 * `Range: bytes=N-M` with a 206 Partial Content reply (and stream the slice
 * via fs.createReadStream so we don't buffer the full file). No-Range path
 * remains a 200 full body.
 */

import { NextResponse } from 'next/server';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { auth } from '@/auth';
// R36 V-INF-3 — INFECTED attachments must not stream the rendered PDF.
import { blockIfInfected } from '@/lib/scan-guard';

const STORAGE_ROOT = path.resolve(process.env.FILE_STORAGE_ROOT ?? './.data/files');

export async function GET(
  req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  await auth().catch(() => null);
  const { id } = ctx.params;

  const filePath = resolvePreviewPath(id);
  if (!filePath) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  // R36 V-INF-3 — INFECTED short-circuit before any fs/stream work.
  const blocked = await blockIfInfected(id);
  if (blocked) return blocked;

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }

  const total = stat.size;
  const rangeHeader = req.headers.get('range');

  if (rangeHeader) {
    const range = parseRange(rangeHeader, total);
    if (!range) {
      // Spec: respond 416 with Content-Range when unsatisfiable.
      return new NextResponse('Range Not Satisfiable', {
        status: 416,
        headers: {
          'Content-Range': `bytes */${total}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
    const { start, end } = range;
    const length = end - start + 1;
    const nodeStream = createReadStream(filePath, { start, end });
    // Convert Node stream -> Web ReadableStream for NextResponse.
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(webStream, {
      status: 206,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(length),
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=60',
      },
    });
  }

  // No Range — full body. Read into a buffer for max compatibility.
  try {
    const buf = await fs.readFile(filePath);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, max-age=60',
        'Content-Length': String(buf.length),
        'Accept-Ranges': 'bytes',
      },
    });
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
}

export async function HEAD(
  _req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  await auth().catch(() => null);
  const filePath = resolvePreviewPath(ctx.params.id);
  if (!filePath) return new NextResponse(null, { status: 400 });
  const blocked = await blockIfInfected(ctx.params.id);
  if (blocked) return new NextResponse(null, { status: 403 });
  try {
    const stat = await fs.stat(filePath);
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
        'Content-Type': 'application/pdf',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

function resolvePreviewPath(id: string): string | null {
  if (!/^[A-Za-z0-9_\-]+$/.test(id)) return null;
  return path.join(STORAGE_ROOT, id, 'preview.pdf');
}

/**
 * Parse a single-range `bytes=` header. We do NOT support multi-range —
 * PDF.js never asks for it and multipart/byteranges is more trouble than
 * it's worth in dev.
 */
function parseRange(
  header: string,
  total: number,
): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const startStr = m[1] ?? '';
  const endStr = m[2] ?? '';
  if (startStr === '' && endStr === '') return null;

  let start: number;
  let end: number;
  if (startStr === '') {
    // Suffix range: last N bytes.
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === '' ? total - 1 : parseInt(endStr, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end >= total || start > end) return null;
  return { start, end };
}
