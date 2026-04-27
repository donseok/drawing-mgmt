// POST /api/v1/admin/conversions/jobs/{id}/retry
//
// R28 V-INF-4 — manual re-enqueue of a FAILED ConversionJob. Resets the
// existing row in-place (status=PENDING, attempt=0, errorMessage=null) and
// pushes a fresh BullMQ job under the same job id so the row's history
// remains a single, linear timeline.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by viewer-engineer (R28).

import { NextResponse } from 'next/server';
import { ConversionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { requeueConversion } from '@/lib/conversion-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
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

  const job = await prisma.conversionJob.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      attachmentId: true,
      status: true,
      attachment: {
        select: { storagePath: true, filename: true, mimeType: true },
      },
    },
  });
  if (!job) return error(ErrorCode.E_NOT_FOUND);

  if (job.status !== ConversionStatus.FAILED) {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      'FAILED 상태의 변환 작업만 재시도할 수 있습니다.',
    );
  }

  // Reset the row first; the BullMQ push happens after so a transient queue
  // error doesn't strand the row in PENDING with a phantom job id. Worst
  // case the admin clicks retry again and we re-push.
  await prisma.conversionJob.update({
    where: { id: job.id },
    data: {
      status: ConversionStatus.PENDING,
      attempt: 0,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    },
  });

  try {
    await requeueConversion(job.id, {
      jobId: job.id,
      attachmentId: job.attachmentId,
      storagePath: job.attachment.storagePath,
      filename: job.attachment.filename,
      mimeType: job.attachment.mimeType,
      outputs: ['pdf', 'dxf', 'thumbnail'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Roll the row back to FAILED so admin sees the error and can try again.
    await prisma.conversionJob.update({
      where: { id: job.id },
      data: {
        status: ConversionStatus.FAILED,
        errorMessage: `requeue failed: ${message}`,
        finishedAt: new Date(),
      },
    });
    return error(ErrorCode.E_INTERNAL, '큐 재등록 실패: ' + message);
  }

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'CONVERSION_RETRY',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      jobId: job.id,
      attachmentId: job.attachmentId,
    },
  });

  return ok({ jobId: job.id, status: 'PENDING' as const });
}
