/**
 * GET /api/v1/attachments/[id]/preview.dxf
 *
 * DXF preview produced by the conversion worker (DWG → DXF via ODA).
 * Reads from `${FILE_STORAGE_ROOT}/<id>/preview.dxf` if present, else 404.
 *
 * Dev-friendly: works without a DB. The ingest script (apps/web/scripts/
 * ingest-dwg.ts) drops files at this exact path, so the viewer can render
 * a real DWG end-to-end without Postgres/Redis.
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
// R47 / FIND-003 — auth + folder VIEW + scan gate.
import { requireAttachmentView } from '@/lib/attachment-auth';
// R48 / FIND-019 — per-preview audit row.
import { extractRequestMeta, logActivity } from '@/lib/audit';

const STORAGE_ROOT = path.resolve(process.env.FILE_STORAGE_ROOT ?? './.data/files');

export async function GET(
  req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  const gate = await requireAttachmentView(req, ctx.params.id);
  if (gate instanceof Response) return gate;
  const { id } = ctx.params;

  // R48 / FIND-019 — preview fetch audit (DXF variant). HEAD probes are
  // intentionally skipped to keep the audit table focused on real reads.
  const auditMeta = extractRequestMeta(req);
  await logActivity({
    userId: gate.user.id,
    action: 'OBJECT_PREVIEW',
    objectId: gate.object.id,
    ipAddress: auditMeta.ipAddress,
    userAgent: auditMeta.userAgent,
    metadata: {
      attachmentId: gate.attachment.id,
      filename: gate.attachment.filename,
      kind: 'dxf',
    },
  });

  const filePath = resolvePreviewPath(id);
  if (!filePath) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  try {
    const buf = await fs.readFile(filePath);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/vnd.dxf',
        'Cache-Control': 'private, max-age=60',
        'Content-Length': String(buf.length),
      },
    });
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
}

export async function HEAD(
  req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  const gate = await requireAttachmentView(req, ctx.params.id);
  if (gate instanceof Response) {
    return new NextResponse(null, { status: gate.status });
  }
  const { id } = ctx.params;
  const filePath = resolvePreviewPath(id);
  if (!filePath) return new NextResponse(null, { status: 400 });
  try {
    const stat = await fs.stat(filePath);
    return new NextResponse(null, {
      status: 200,
      headers: { 'Content-Length': String(stat.size) },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

function resolvePreviewPath(id: string): string | null {
  // Reject path traversal — ids should be uuid-ish.
  if (!/^[A-Za-z0-9_\-]+$/.test(id)) return null;
  return path.join(STORAGE_ROOT, id, 'preview.dxf');
}
