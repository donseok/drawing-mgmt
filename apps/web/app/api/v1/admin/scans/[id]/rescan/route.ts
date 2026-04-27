// POST /api/v1/admin/scans/{id}/rescan
//
// R36 V-INF-3 — manual re-enqueue of a virus scan. Only INFECTED or FAILED
// attachments are eligible; CLEAN/SKIPPED stay as-is (admin can purge them
// via attachment delete if they want to force a re-scan from scratch).
//
// Resets the row in-place (virusScanStatus=PENDING, clears sig/at) and
// pushes a fresh BullMQ job under the same job id (= attachment id) so the
// row's history remains a single, linear timeline.
//
// Authorization: SUPER_ADMIN or ADMIN.

import { NextResponse } from 'next/server';
import { VirusScanStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';
import { requeueVirusScan } from '@/lib/scan-queue';

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
        storagePath: true,
        size: true,
        virusScanStatus: true,
      },
    });
    if (!att) return error(ErrorCode.E_NOT_FOUND);

    if (
      att.virusScanStatus !== VirusScanStatus.INFECTED &&
      att.virusScanStatus !== VirusScanStatus.FAILED
    ) {
      return error(
        ErrorCode.E_STATE_CONFLICT,
        'INFECTED 또는 FAILED 상태의 첨부만 재스캔할 수 있습니다.',
      );
    }

    // Reset the row first; the BullMQ push happens after so a transient
    // queue error doesn't strand the row in PENDING with a phantom job id.
    // Worst case the admin clicks rescan again and we re-push.
    await prisma.attachment.update({
      where: { id: att.id },
      data: {
        virusScanStatus: VirusScanStatus.PENDING,
        virusScanSig: null,
        virusScanAt: null,
      },
    });

    const queueResult = await requeueVirusScan({
      attachmentId: att.id,
      storagePath: att.storagePath,
      filename: att.filename,
      size: Number(att.size),
    });

    if (!queueResult.ok) {
      // Roll the row back to FAILED so admin sees the error and can try again.
      await prisma.attachment.update({
        where: { id: att.id },
        data: {
          virusScanStatus: VirusScanStatus.FAILED,
        },
      });
      return error(
        ErrorCode.E_INTERNAL,
        '큐 재등록 실패: ' + (queueResult.error ?? 'unknown'),
      );
    }

    const meta = extractRequestMeta(req);
    await logActivity({
      userId: user.id,
      action: 'VIRUS_SCAN_RETRY',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        attachmentId: att.id,
        previousStatus: att.virusScanStatus,
      },
    });

    return ok({
      attachmentId: att.id,
      virusScanStatus: 'PENDING' as const,
    });
  },
);
