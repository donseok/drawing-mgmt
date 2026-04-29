// POST /api/v1/approvals/:id/action
//
// Unified action endpoint for the approval inbox UI (BUG-003 / FE-2).
// Body: { action: 'approve' | 'reject' | 'defer' | 'recall', comment?, signatureFile? }
//
// Semantics:
//   approve — same as POST /approvals/:id/approve (active approver only).
//   reject  — same as POST /approvals/:id/reject  (active approver only).
//   defer   — push the active step's order to the back of the queue so the
//             next step becomes active. Only the active approver may defer.
//             Comment optional; the deferred step stays PENDING.
//   recall  — requester only, while the approval is still PENDING.
//             Marks the approval CANCELLED and releases the lock on
//             the underlying object (CHECKED_IN).
//
// We deliberately keep this thin: approve/reject delegate to the existing
// dedicated route handlers via internal forwarding so the state-machine logic
// stays in one place. defer/recall live here because they're new.
//
// Owned by BE-2.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApprovalStatus, StepStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';
import { canTransition } from '@/lib/state-machine';
import { approveHandler } from '@/app/api/v1/approvals/[id]/approve/route';
import { rejectHandler } from '@/app/api/v1/approvals/[id]/reject/route';

const bodySchema = z.object({
  action: z.enum(['approve', 'reject', 'defer', 'recall']),
  comment: z.string().max(2000).optional(),
  signatureFile: z.string().max(500).optional(),
});

export const POST = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req, ctx) => {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const dto = parsed.data;

  // Build a forwarding request that strips the `action` discriminator so the
  // delegated handler sees the body shape it expects.
  const forwardBody = JSON.stringify({
    ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
    ...(dto.signatureFile !== undefined ? { signatureFile: dto.signatureFile } : {}),
  });
  const forwardInit: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: forwardBody,
  };

  if (dto.action === 'approve') {
    const fwd = new Request(req.url, forwardInit);
    return approveHandler(fwd, ctx);
  }

  if (dto.action === 'reject') {
    if (!dto.comment || dto.comment.trim().length === 0) {
      return error(ErrorCode.E_VALIDATION, '반려 사유를 입력하세요.');
    }
    const fwd = new Request(req.url, forwardInit);
    return rejectHandler(fwd, ctx);
  }

  // ── defer ─────────────────────────────────────────────────────────────
  if (dto.action === 'defer') {
    return handleDefer(req, user.id, ctx.params.id, dto.comment ?? null);
  }

  // ── recall ────────────────────────────────────────────────────────────
  return handleRecall(req, user.id, ctx.params.id, dto.comment ?? null);
  },
);

async function handleDefer(
  req: Request,
  userId: string,
  approvalId: string,
  comment: string | null,
): Promise<NextResponse> {
  const approval = await prisma.approval.findUnique({
    where: { id: approvalId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
  if (!approval) return error(ErrorCode.E_NOT_FOUND);
  if (approval.status !== ApprovalStatus.PENDING) {
    return error(ErrorCode.E_STATE_CONFLICT, '진행 중인 결재가 아닙니다.');
  }

  const waitingSteps = approval.steps.filter((s) => s.status === StepStatus.PENDING);
  if (waitingSteps.length === 0) {
    return error(ErrorCode.E_STATE_CONFLICT, '대기 중인 결재 단계가 없습니다.');
  }
  const activeStep = waitingSteps.reduce((a, b) => (a.order <= b.order ? a : b));
  if (activeStep.approverId !== userId) {
    return error(ErrorCode.E_FORBIDDEN, '본인 차례의 결재가 아닙니다.');
  }
  if (waitingSteps.length === 1) {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      '미루기 가능한 다음 단계가 없습니다.',
    );
  }

  const maxOrder = approval.steps.reduce(
    (m, s) => (s.order > m ? s.order : m),
    activeStep.order,
  );

  await prisma.$transaction(async (tx) => {
    // Move the active step to the very back. We use a temporary negative
    // order to dodge the @@unique([approvalId, order]) collision.
    await tx.approvalStep.update({
      where: { id: activeStep.id },
      data: { order: -activeStep.id.length, comment: comment ?? activeStep.comment },
    });

    // Shift every step strictly after activeStep.order down by one.
    const toShift = approval.steps
      .filter((s) => s.order > activeStep.order)
      .sort((a, b) => a.order - b.order);
    for (const s of toShift) {
      await tx.approvalStep.update({
        where: { id: s.id },
        data: { order: s.order - 1 },
      });
    }

    // Park the active step at the new tail position.
    await tx.approvalStep.update({
      where: { id: activeStep.id },
      data: { order: maxOrder },
    });
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId,
    action: 'APPROVAL_DEFER',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { approvalId, stepId: activeStep.id },
  });

  return ok({
    approvalId,
    stepId: activeStep.id,
    approvalStatus: ApprovalStatus.PENDING,
  });
}

async function handleRecall(
  req: Request,
  userId: string,
  approvalId: string,
  comment: string | null,
): Promise<NextResponse> {
  const approval = await prisma.approval.findUnique({
    where: { id: approvalId },
    include: { revision: { include: { object: true } } },
  });
  if (!approval) return error(ErrorCode.E_NOT_FOUND);
  if (approval.requesterId !== userId) {
    return error(ErrorCode.E_FORBIDDEN, '본인이 상신한 결재만 회수할 수 있습니다.');
  }
  if (approval.status !== ApprovalStatus.PENDING) {
    return error(ErrorCode.E_STATE_CONFLICT, '회수 가능한 상태가 아닙니다.');
  }

  const now = new Date();

  const t = canTransition(approval.revision.object.state, 'recall', { userId });
  const nextObjectState = t.ok && t.next ? t.next : approval.revision.object.state;

  await prisma.$transaction(async (tx) => {
    await tx.approval.update({
      where: { id: approval.id },
      data: { status: ApprovalStatus.CANCELLED, completedAt: now },
    });
    // Release the underlying object lock so the requester can revise.
    if (t.ok && t.next) {
      await tx.objectEntity.update({
        where: { id: approval.revision.object.id },
        data: { state: t.next, lockedById: null },
      });
    }
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId,
    action: 'APPROVAL_RECALL',
    objectId: approval.revision.object.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { approvalId, comment },
  });

  return ok({
    approvalId,
    approvalStatus: ApprovalStatus.CANCELLED,
    objectState: nextObjectState,
  });
}
