// POST /api/v1/admin/pdf-extracts/{id}/retry
//
// R41 / A — manual re-enqueue of a pdf-extract job from /admin/pdf-extracts.
// Only FAILED or SKIPPED rows are eligible (the others are either healthy
// or in flight, and re-pushing them would create duplicate work).
//
// Mirrors the shape of POST /api/v1/admin/scans/{id}/rescan (R36 V-INF-3) so
// the admin UI can reuse the same row-level retry pattern. Differences:
//   - The pdf-extract worker dedupes via `<attachmentId>:<pdfStorageKey>`
//     (storage key is part of the BullMQ jobId), so we can't reuse the
//     attachment id alone.
//   - SKIPPED rows may not have a preview.pdf yet (the conversion produced
//     no PDF). We re-probe storage here and 409 with a meaningful message
//     rather than enqueuing a job that's guaranteed to fail.
//
// Authorization: SUPER_ADMIN or ADMIN.

import { NextResponse } from 'next/server';
import { PdfExtractStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';
import { requeuePdfExtract } from '@/lib/pdf-extract-queue';
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      return error(ErrorCode.E_FORBIDDEN);
    }

    const att = await prisma.attachment.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        filename: true,
        pdfExtractStatus: true,
      },
    });
    if (!att) return error(ErrorCode.E_NOT_FOUND);

    // State guard — only retry rows that have either explicitly failed or
    // were skipped. Rows in PENDING/EXTRACTING are already in flight, and
    // DONE rows have nothing to retry.
    if (
      att.pdfExtractStatus !== PdfExtractStatus.FAILED &&
      att.pdfExtractStatus !== PdfExtractStatus.SKIPPED
    ) {
      return error(
        ErrorCode.E_STATE_CONFLICT,
        'FAILED 또는 SKIPPED 상태의 첨부만 재시도할 수 있습니다.',
      );
    }

    // Probe storage for the canonical preview PDF key — the worker will
    // need it; a SKIPPED row whose preview never materialized would
    // immediately go FAILED again. Bail early with a friendly 409 so the
    // admin doesn't waste a queue cycle.
    const pdfStorageKey = `${att.id}/preview.pdf`;
    const storage = getStorage();
    const exists = await storage.exists(pdfStorageKey).catch(() => false);
    if (!exists) {
      return error(
        ErrorCode.E_STATE_CONFLICT,
        'PDF 미리보기가 없어 재추출할 수 없습니다. 변환을 먼저 재실행하세요.',
      );
    }

    // Reset the row first; the BullMQ push happens after so a transient
    // queue error doesn't strand the row as PENDING with no live job.
    // If the queue add fails we roll back to FAILED so the admin can
    // retry again from a recognizable state.
    await prisma.attachment.update({
      where: { id: att.id },
      data: {
        pdfExtractStatus: PdfExtractStatus.PENDING,
        pdfExtractError: null,
        // Leave pdfExtractAt untouched — the FE wants "last attempt at"
        // not "last status change", and a successful retry will stamp it
        // anyway in the worker DONE branch.
      },
    });

    const queueResult = await requeuePdfExtract({
      attachmentId: att.id,
      pdfStorageKey,
    });

    if (!queueResult.ok) {
      await prisma.attachment.update({
        where: { id: att.id },
        data: { pdfExtractStatus: PdfExtractStatus.FAILED },
      });
      return error(
        ErrorCode.E_INTERNAL,
        '큐 재등록 실패: ' + (queueResult.error ?? 'unknown'),
      );
    }

    const meta = extractRequestMeta(req);
    await logActivity({
      userId: user.id,
      action: 'PDF_EXTRACT_RETRY',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        attachmentId: att.id,
        previousStatus: att.pdfExtractStatus,
      },
    });

    return ok({
      attachmentId: att.id,
      pdfExtractStatus: 'PENDING' as const,
    });
  },
);
