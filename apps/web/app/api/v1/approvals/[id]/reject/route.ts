// POST /api/v1/approvals/:id/reject
//
// The current active approver rejects the approval. Per TRD §5.3, the
// underlying object transitions IN_APPROVAL → CHECKED_IN so the requester
// can revise and re-submit. The Approval is marked REJECTED and any
// remaining PENDING steps are left as-is (audit-friendly).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApprovalStatus, ObjectState, StepStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { enqueueNotification } from '@/lib/notifications';

const bodySchema = z.object({
  comment: z.string().min(1).max(2000),
  signatureFile: z.string().max(500).optional(),
});

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }

  const approval = await prisma.approval.findUnique({
    where: { id: params.id },
    include: {
      steps: { orderBy: { order: 'asc' } },
      revision: { include: { object: true } },
    },
  });
  if (!approval) return error(ErrorCode.E_NOT_FOUND);
  if (approval.status !== ApprovalStatus.PENDING) {
    return error(ErrorCode.E_STATE_CONFLICT, '진행 중인 결재가 아닙니다.');
  }

  const activeStep = approval.steps.find((s) => s.status === StepStatus.PENDING);
  if (!activeStep) {
    return error(ErrorCode.E_STATE_CONFLICT, '대기 중인 결재 단계가 없습니다.');
  }
  if (activeStep.approverId !== user.id) {
    return error(ErrorCode.E_FORBIDDEN, '본인 차례의 결재가 아닙니다.');
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.approvalStep.update({
      where: { id: activeStep.id },
      data: {
        status: StepStatus.REJECTED,
        comment: parsed.data.comment,
        signatureFile: parsed.data.signatureFile ?? null,
        actedAt: now,
      },
    });
    await tx.approval.update({
      where: { id: approval.id },
      data: { status: ApprovalStatus.REJECTED, completedAt: now },
    });
    await tx.objectEntity.update({
      where: { id: approval.revision.object.id },
      data: { state: ObjectState.CHECKED_IN, lockedById: null },
    });

    // R29 / N-1 — notify the requester of the rejection. Comment is short
    // enough to inline as the body; full comment is available on the step.
    if (approval.requesterId !== user.id) {
      await enqueueNotification(tx, {
        userId: approval.requesterId,
        type: 'APPROVAL_REJECT',
        title: '결재가 반려되었습니다',
        body: `${approval.revision.object.number} — ${approval.title}`,
        objectId: approval.revision.object.id,
        metadata: {
          approvalId: approval.id,
          rejecterId: user.id,
          comment: parsed.data.comment,
        },
      });
    }
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'REJECT',
    objectId: approval.revision.object.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { approvalId: approval.id, stepId: activeStep.id },
  });

  return ok({
    approvalId: approval.id,
    stepId: activeStep.id,
    approvalStatus: ApprovalStatus.REJECTED,
    objectState: ObjectState.CHECKED_IN,
  });
}
