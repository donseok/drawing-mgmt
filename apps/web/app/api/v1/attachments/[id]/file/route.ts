/**
 * GET /api/v1/attachments/[id]/file
 *
 * Original (uploaded) source file download — backs the "원본 다운로드" button.
 *
 * Resolution order (driver-agnostic via the storage abstraction):
 *   1. `<id>/meta.json` sidecar — the canonical record. R21 / R31 finalize
 *      both write this with `storagePath` pointing at the actual blob.
 *   2. Convention scan — `<id>/source.dwg` first, then `source.*` discovered
 *      via `storage.list(<id>/, …)`. Covers the dev ingest script which
 *      pre-dates the sidecar.
 *
 * `Content-Disposition: attachment` uses the sidecar's `filename` when
 * available so the browser saves with the original name. 404 if no source.
 *
 * R34 V-INF-1 — fs.* calls swapped for `getStorage()` so on-prem can switch
 * to MinIO/S3 by flipping STORAGE_DRIVER. Response shape is unchanged.
 */

import { NextResponse } from 'next/server';
import path from 'node:path';
import { auth } from '@/auth';
import { getStorage } from '@/lib/storage';
import { StorageNotFoundError } from '@drawing-mgmt/shared/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const storage = getStorage();
  const sidecar = await readSidecar(storage, id);
  const sourceKey = await resolveSource(storage, id, sidecar);
  if (!sourceKey) {
    return new NextResponse('Not Found', { status: 404 });
  }

  let got;
  try {
    got = await storage.get(sourceKey);
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      return new NextResponse('Not Found', { status: 404 });
    }
    throw err;
  }

  const filename = sidecar?.filename ?? path.basename(sourceKey);
  const contentType =
    sidecar?.mimeType ?? got.contentType ?? guessMime(filename);

  // Stream — source files can be large (DWGs can hit hundreds of MB).
  // Storage drivers return Node Readable streams; convert to Web stream
  // so NextResponse can pass them through without buffering.
  const { Readable } = await import('node:stream');
  const webStream = Readable.toWeb(
    got.stream as InstanceType<typeof Readable>,
  ) as unknown as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(got.size),
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
  const storage = getStorage();
  const sidecar = await readSidecar(storage, id);
  const sourceKey = await resolveSource(storage, id, sidecar);
  if (!sourceKey) return new NextResponse(null, { status: 404 });
  const stat = await storage.stat(sourceKey);
  if (!stat) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, {
    status: 200,
    headers: { 'Content-Length': String(stat.size) },
  });
}

import type { Storage } from '@drawing-mgmt/shared/storage';

async function readSidecar(
  storage: Storage,
  id: string,
): Promise<Sidecar | null> {
  try {
    const got = await storage.get(`${id}/meta.json`);
    const buf = await streamToBuffer(got.stream);
    return JSON.parse(buf.toString('utf8')) as Sidecar;
  } catch {
    return null;
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function resolveSource(
  storage: Storage,
  id: string,
  sidecar: Sidecar | null,
): Promise<string | null> {
  // 1) Sidecar storagePath wins when available — it's the truth written by
  //    R21 / R31 finalize and survives extension changes.
  if (sidecar?.storagePath) {
    if (await storage.exists(sidecar.storagePath)) {
      return sidecar.storagePath;
    }
  }

  // 2) Try canonical source.dwg (dev ingest writes this).
  const canonical = `${id}/source.dwg`;
  if (await storage.exists(canonical)) return canonical;

  // 3) List the attachment dir for any source.* sibling.
  try {
    const { items } = await storage.list(`${id}/`, { limit: 50 });
    const match = items.find((it) => {
      const name = it.key.slice(id.length + 1);
      return name.startsWith('source.');
    });
    if (match) return match.key;
  } catch {
    /* ignore — treat as not found */
  }
  return null;
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
