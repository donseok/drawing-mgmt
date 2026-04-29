// GET /api/v1/print-jobs/{jobId}/status
//
// R31 / P-1 — return the status of a PRINT or PDF_MERGE ConversionJob row.
// FE polls this until status is DONE (and surfaces `pdfUrl` for download/
// print) or FAILED (and surfaces `errorMessage`).
//
// PRINT: per-attachment PDF render. Permission gate is the same as
//        POST /api/v1/attachments/{id}/print — folder PRINT bit on the
//        underlying object.
//
// PDF_MERGE (R-PDF-MERGE): aggregate of N attachments. The metadata carries
//        `requestedBy` (user id who created the job) so we can enforce that
//        only the requester (or an admin/super_admin) can poll status. The
//        per-attachment permission was already validated at enqueue time —
//        re-checking it here would punish the requester if folder ACL
//        changed mid-flight, which is the wrong UX.
//
// Auth: must be authenticated AND either own the job (PDF_MERGE) or hold
//        PRINT on the attachment (PRINT). We do NOT expose status to
//        anyone who happens to know a jobId.

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

interface PdfMergeFailureMeta {
  objectId?: string;
  reason?: string;
}

interface ConversionJobMetadata {
  kind?: 'PRINT' | 'PDF_MERGE';
  requestedBy?: string;
  totalCount?: number;
  successCount?: number;
  failureCount?: number;
  failures?: PdfMergeFailureMeta[];
}

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

  // R-PDF-MERGE — accept PRINT and PDF_MERGE; reject everything else
  // (regular DWG conversion jobs use the admin endpoint).
  const meta = (job.metadata ?? null) as ConversionJobMetadata | null;
  const kind = meta?.kind;
  if (kind && kind !== 'PRINT' && kind !== 'PDF_MERGE') {
    return error(ErrorCode.E_NOT_FOUND);
  }

  // Permission gate — branches on `kind`.
  if (kind === 'PDF_MERGE') {
    // Requester or admin/super_admin only. (Per-row PRINT was validated at
    // enqueue time; we don't re-check here so an ACL flip mid-flight doesn't
    // strand the requester.)
    const isOwner = meta?.requestedBy === user.id;
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    if (!isOwner && !isAdmin) {
      return error(ErrorCode.E_FORBIDDEN);
    }
  } else {
    // PRINT (or legacy rows w/o metadata.kind) — re-check folder PRINT bit.
    const obj = job.attachment?.version?.revision?.object ?? null;
    if (!obj) return error(ErrorCode.E_NOT_FOUND);

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
  }

  // pdfUrl — surface only when DONE so FE can guard on it. PDF_MERGE has its
  // own download endpoint; PRINT keeps the existing per-attachment URL.
  let pdfUrl: string | undefined;
  if (job.status === 'DONE' && job.pdfPath) {
    pdfUrl =
      kind === 'PDF_MERGE'
        ? `/api/v1/print-jobs/${job.id}/merged.pdf`
        : `/api/v1/attachments/${job.attachmentId}/preview.pdf`;
  }

  // PDF_MERGE-only response fields. Worker writes totalCount/successCount/
  // failureCount/failures into metadata when the job finishes (or partially
  // fails). FE renders failure breakdown from these.
  if (kind === 'PDF_MERGE') {
    return ok({
      jobId: job.id,
      status: job.status,
      errorMessage: job.errorMessage,
      pdfUrl,
      kind: 'PDF_MERGE' as const,
      totalCount: meta?.totalCount ?? 0,
      successCount: meta?.successCount ?? 0,
      failureCount: meta?.failureCount ?? 0,
      failures: (meta?.failures ?? []).map((f) => ({
        objectId: f.objectId ?? '',
        reason: f.reason ?? '',
      })),
    });
  }

  // PRINT (default) response — unchanged from R31.
  return ok({
    jobId: job.id,
    status: job.status,
    errorMessage: job.errorMessage,
    pdfUrl,
  });
}
