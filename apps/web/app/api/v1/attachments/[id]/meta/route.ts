/**
 * GET /api/v1/attachments/[id]/meta
 *
 * Attachment metadata for the viewer title bar / capability hints.
 *
 * Dev mode: probes FILE_STORAGE_ROOT/<id>/ for preview files and returns
 * realistic capability flags. If nothing is found, falls back to a synthetic
 * record so the viewer still renders end-to-end with sample fixtures.
 *
 * Real impl: read from Prisma `Attachment` joined with parent `Object`.
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { auth } from '@/auth';
import type { AttachmentMeta } from '@/lib/viewer/types';

const STORAGE_ROOT = path.resolve(process.env.FILE_STORAGE_ROOT ?? './.data/files');

export async function GET(
  _req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  await auth().catch(() => null);
  const { id } = ctx.params;

  const dir = /^[A-Za-z0-9_\-]+$/.test(id) ? path.join(STORAGE_ROOT, id) : null;
  const sidecar = dir ? await readSidecar(dir) : null;
  const [hasPdf, hasDxf, hasThumb] = dir
    ? await Promise.all([
        fileExists(path.join(dir, 'preview.pdf')),
        fileExists(path.join(dir, 'preview.dxf')),
        fileExists(path.join(dir, 'thumbnail.png')),
      ])
    : [false, false, false];

  const meta: AttachmentMeta = {
    id,
    filename: sidecar?.filename ?? 'sample-drawing.dwg',
    mimeType: sidecar?.mimeType ?? 'application/acad',
    size: sidecar?.size ?? 0,
    isMaster: true,
    conversionStatus: 'success',
    hasPdf,
    hasDxf,
    hasThumbnail: hasThumb,
    objectId: sidecar?.objectId ?? 'dev-object',
    objectNumber: sidecar?.objectNumber ?? 'CGL-DEV-2026-00001',
    objectName: sidecar?.objectName ?? '샘플 도면 (개발 모드)',
  };

  return NextResponse.json(meta, {
    headers: { 'Cache-Control': 'private, max-age=10' },
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

interface Sidecar {
  filename?: string;
  mimeType?: string;
  size?: number;
  objectId?: string;
  objectNumber?: string;
  objectName?: string;
}

/** Optional `meta.json` written by the dev ingest script. */
async function readSidecar(dir: string): Promise<Sidecar | null> {
  try {
    const raw = await fs.readFile(path.join(dir, 'meta.json'), 'utf8');
    return JSON.parse(raw) as Sidecar;
  } catch {
    return null;
  }
}
