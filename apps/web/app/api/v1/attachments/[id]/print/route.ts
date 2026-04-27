// POST /api/v1/attachments/{id}/print
//
// R31 / P-1 — request a PDF render of the attachment for printing.
//
// Flow:
//   1. Auth + load the attachment + its parent ObjectEntity (we need
//      folderId/ownerId/securityLevel to evaluate PRINT permission).
//   2. Permission check — admin bypass; otherwise canAccess(PRINT).
//   3. enqueuePrint() — looks up an already-cached PDF (matching ctb +
//      pageSize). If hit, returns `status: 'CACHED'` + the streamable
//      pdfUrl. Otherwise inserts a ConversionJob row with
//      `metadata.kind='PRINT'` and pushes to the pdf-print BullMQ queue.
//   4. ActivityLog `PRINT_REQUEST`. FE polls the status endpoint via
//      `GET /api/v1/print-jobs/{jobId}/status` until DONE/FAILED.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  loadFolderPermissions,
  toPermissionUser,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';
import { enqueuePrint } from '@/lib/conversion-queue';
// R36 V-INF-3 — INFECTED attachments must not be printable.
import { blockIfInfected } from '@/lib/scan-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  ctb: z.enum(['mono', 'color-a3']).default('mono'),
  pageSize: z.enum(['A4', 'A3']).default('A4'),
});

export const POST = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
    let user;
    try {
      user = await requireUser();
    } catch (err) {
      if (err instanceof Response) return err as NextResponse;
      throw err;
    }

    // Body — both fields optional with defaults; reject unknown shapes so
    // typos don't silently degrade to default behavior.
    let payload: z.infer<typeof bodySchema>;
    try {
      const raw = await req.json().catch(() => ({}));
      payload = bodySchema.parse(raw ?? {});
    } catch (err) {
      return error(
        ErrorCode.E_VALIDATION,
        '인쇄 옵션이 올바르지 않습니다.',
        undefined,
        err instanceof z.ZodError ? err.flatten() : undefined,
      );
    }

    // Load attachment with its parent object so we can evaluate PRINT.
    const attachment = await prisma.attachment.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        storagePath: true,
        version: {
          select: {
            revision: {
              select: {
                object: {
                  select: {
                    id: true,
                    folderId: true,
                    ownerId: true,
                    securityLevel: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    const obj = attachment?.version?.revision?.object ?? null;
    if (!attachment || !obj) return error(ErrorCode.E_NOT_FOUND);

    // R36 V-INF-3 — INFECTED short-circuit before permission check.
    const blocked = await blockIfInfected(attachment.id);
    if (blocked) return blocked;

    // Permission — admin/super_admin bypass the per-folder PRINT bit, since
    // they bypass all FolderPermission rows in canAccess().
    const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fullUser) return error(ErrorCode.E_AUTH);
    const [pUser, perms] = await Promise.all([
      toPermissionUser(fullUser),
      loadFolderPermissions([obj.folderId]),
    ]);
    const decision = canAccess(pUser, obj, perms, 'PRINT');
    if (!decision.allowed) {
      return error(ErrorCode.E_FORBIDDEN, decision.reason);
    }

    const result = await enqueuePrint({
      attachmentId: attachment.id,
      storagePath: attachment.storagePath,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      ctb: payload.ctb,
      pageSize: payload.pageSize,
    });

    if (!result.ok) {
      return error(
        ErrorCode.E_INTERNAL,
        '인쇄 작업 등록에 실패했습니다: ' + result.error,
      );
    }

    const pdfUrl = `/api/v1/attachments/${attachment.id}/preview.pdf`;

    const meta = extractRequestMeta(req);
    await logActivity({
      userId: user.id,
      action: 'PRINT_REQUEST',
      objectId: obj.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        attachmentId: attachment.id,
        jobId: result.jobId,
        ctb: payload.ctb,
        pageSize: payload.pageSize,
        status: result.status,
      },
    });

    if (result.status === 'CACHED') {
      return ok({
        jobId: result.jobId,
        status: 'CACHED' as const,
        pdfUrl,
      });
    }
    return ok({
      jobId: result.jobId,
      status: 'QUEUED' as const,
    });
  },
);
