/**
 * GET /api/v1/attachments/[id]/meta
 *
 * Attachment metadata for the viewer title bar / capability hints.
 *
 * Real impl: read from Prisma `Attachment` joined with parent `Object`.
 * Stub: synthesize a "success" record so the viewer renders end-to-end in
 * dev without DB seed.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { AttachmentMeta } from '@/lib/viewer/types';

export async function GET(
  _req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  // DEV/DEMO: auth optional so viewer can demo without DB. TODO: production gate.
  await auth().catch(() => null);
  const { id } = ctx.params;

  // Stub data — replace with Prisma lookup once Attachment table is seeded.
  const meta: AttachmentMeta = {
    id,
    filename: 'sample-drawing.dwg',
    mimeType: 'application/acad',
    size: 0,
    isMaster: true,
    conversionStatus: 'success',
    hasPdf: true,
    hasDxf: true,
    hasThumbnail: true,
    objectId: 'dev-object',
    objectNumber: 'CGL-DEV-2026-00001',
    objectName: '샘플 도면 (개발 모드)',
  };

  return NextResponse.json(meta, {
    headers: { 'Cache-Control': 'private, max-age=10' },
  });
}
