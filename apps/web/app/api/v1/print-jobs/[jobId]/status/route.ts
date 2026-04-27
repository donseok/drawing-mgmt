// GET /api/v1/print-jobs/{jobId}/status
//
// R31 / P-1 — return the status of a PRINT ConversionJob row. FE polls
// this until status is DONE (and surfaces `pdfUrl` for download/print) or
// FAILED (and surfaces `errorMessage`).
//
// Auth: same gate as POST /print — must be authenticated AND have PRINT
// permission on the underlying attachment's folder. We don't expose the
// status to anyone who happens to know a jobId.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  loadFolderPermissions,
  toPermissionUser,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const job = await prisma.conversionJob.findUnique({
    where: { id: params.jobId },
    select: {
      id: true,
      status: true,
      errorMessage: true,
      pdfPath: true,
      attachmentId: true,
      metadata: true,
      attachment: {
        select: {
          id: true,
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
      },
    },
  });
  if (!job) return error(ErrorCode.E_NOT_FOUND);

  // Defensive: only return PRINT job statuses through this endpoint. Regular
  // DWG conversion jobs use the admin endpoint.
  const meta = (job.metadata ?? null) as { kind?: string } | null;
  if (meta?.kind && meta.kind !== 'PRINT') {
    return error(ErrorCode.E_NOT_FOUND);
  }

  const obj = job.attachment?.version?.revision?.object ?? null;
  if (!obj) return error(ErrorCode.E_NOT_FOUND);

  // Permission re-check — same gate as POST /print.
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

  // pdfUrl — surface only when DONE so FE can guard on it.
  const pdfUrl =
    job.status === 'DONE' && job.pdfPath
      ? `/api/v1/attachments/${job.attachmentId}/preview.pdf`
      : undefined;

  return ok({
    jobId: job.id,
    status: job.status,
    errorMessage: job.errorMessage,
    pdfUrl,
  });
}
