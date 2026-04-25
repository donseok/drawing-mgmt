/**
 * GET /api/v1/attachments/[id]/file
 *
 * Original (uploaded) source file download — backs the "원본 다운로드" button.
 *
 * Resolution order under `${FILE_STORAGE_ROOT}/<id>/`:
 *   1. `source.dwg`    — written by the dev ingest script (apps/web/scripts/ingest-dwg.ts)
 *   2. `source.*`      — any other source extension (.dxf, .pdf, …)
 *   3. `meta.json`     — fall back to `storagePath` if recorded
 *
 * `Content-Disposition: attachment` uses the sidecar's `filename` when
 * available so the browser saves with the original name. 404 if no source.
 *
 * Real impl will stream from object storage and verify checksum (TRD §4).
 */

import { NextResponse } from 'next/server';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { auth } from '@/auth';

const STORAGE_ROOT = path.resolve(process.env.FILE_STORAGE_ROOT ?? './.data/files');

interface Sidecar {
  filename?: string;
  mimeType?: string;
  size?: number;
  storagePath?: string;
}

export async function GET(
  _req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  // DEV/DEMO: auth optional so viewer can demo without DB. TODO: production gate.
  await auth().catch(() => null);
  const { id } = ctx.params;

  if (!/^[A-Za-z0-9_\-]+$/.test(id)) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  const dir = path.join(STORAGE_ROOT, id);
  const sidecar = await readSidecar(dir);
  const sourcePath = await resolveSource(dir, sidecar);
  if (!sourcePath) {
    return new NextResponse('Not Found', { status: 404 });
  }

  let stat;
  try {
    stat = await fs.stat(sourcePath);
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }

  const filename = sidecar?.filename ?? path.basename(sourcePath);
  const contentType = sidecar?.mimeType ?? guessMime(filename);

  // Stream — source files can be large (DWGs can hit hundreds of MB).
  const nodeStream = createReadStream(sourcePath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${encodeFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function HEAD(
  _req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  await auth().catch(() => null);
  const { id } = ctx.params;
  if (!/^[A-Za-z0-9_\-]+$/.test(id)) {
    return new NextResponse(null, { status: 400 });
  }
  const dir = path.join(STORAGE_ROOT, id);
  const sidecar = await readSidecar(dir);
  const sourcePath = await resolveSource(dir, sidecar);
  if (!sourcePath) return new NextResponse(null, { status: 404 });
  try {
    const stat = await fs.stat(sourcePath);
    return new NextResponse(null, {
      status: 200,
      headers: { 'Content-Length': String(stat.size) },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

async function readSidecar(dir: string): Promise<Sidecar | null> {
  try {
    const raw = await fs.readFile(path.join(dir, 'meta.json'), 'utf8');
    return JSON.parse(raw) as Sidecar;
  } catch {
    return null;
  }
}

async function resolveSource(
  dir: string,
  sidecar: Sidecar | null,
): Promise<string | null> {
  // 1. Try canonical source.dwg first (dev ingest writes this).
  const canonical = path.join(dir, 'source.dwg');
  if (await exists(canonical)) return canonical;

  // 2. Look for any source.* sibling.
  try {
    const entries = await fs.readdir(dir);
    const source = entries.find((n) => n.startsWith('source.'));
    if (source) return path.join(dir, source);
  } catch {
    /* dir doesn't exist yet */
  }

  // 3. Fall back to sidecar.storagePath if it lives under STORAGE_ROOT.
  if (sidecar?.storagePath) {
    const candidate = path.resolve(STORAGE_ROOT, sidecar.storagePath);
    if (candidate.startsWith(STORAGE_ROOT) && (await exists(candidate))) {
      return candidate;
    }
  }
  return null;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function guessMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.dwg':
      return 'application/acad';
    case '.dxf':
      return 'image/vnd.dxf';
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

/**
 * ASCII-safe fallback for the legacy `filename=` form. Browsers will prefer
 * `filename*=` (RFC 5987) when both are present, but include this so old
 * clients still get a sensible name.
 */
function encodeFilename(name: string): string {
  // Strip CR/LF/quotes that would break the header; replace non-ASCII.
  return name
    .replace(/[\r\n"]/g, '')
    .replace(/[^\x20-\x7E]/g, '_');
}
