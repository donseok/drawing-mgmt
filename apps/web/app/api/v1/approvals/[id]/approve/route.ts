// POST /api/v1/approvals/:id/approve
//
// The current user must be the *active* step approver (lowest-order PENDING).
// Sets that step to APPROVED. If it was the last step, the approval becomes
// APPROVED, the underlying ObjectEntity transitions to APPROVED, and
// currentRevision is incremented (resetting currentVersion to 0.0).
//
// R4a — schema collapsed PENDING+IN_PROGRESS → PENDING and renamed
// StepStatus.WAITING → PENDING. The active-step rule is unchanged.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApprovalStatus, ObjectState, Prisma, StepStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { enqueueNotification } from '@/lib/notifications';
import { withApi } from '@/lib/api-helpers';
import { canTransition } from '@/lib/state-machine';

const bodySchema = z.object({
  comment: z.string().max(2000).optional(),
  /** Path to a captured signature image (uploaded separately). */
  signatureFile: z.string().max(500).optional(),
});

/**
 * Inner handler — exported unwrapped so `approvals/[id]/action/route.ts` can
 * forward without re-running the CSRF + rate-limit gate (the wrapped POST
 * runs them once at the outer entry; an inner forward would double-fire and
 * the synthetic forward Request has no Origin header → CSRF would reject).
 */
export async function approveHandler(
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

  let parsedBody: z.infer<typeof bodySchema> = {};
  if (req.headers.get('content-length') && req.headers.get('content-length') !== '0') {
    try {
      const raw = await req.json();
      const safe = bodySchema.safeParse(raw);
      if (!safe.success) {
        return error(
          ErrorCode.E_VALIDATION,
          undefined,
          undefined,
          safe.error.flatten(),
        );
      }
      parsedBody = safe.data;
    } catch {
      // empty body OK
    }
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

  // Identify the active step.
  const activeStep = approval.steps.find((s) => s.status === StepStatus.PENDING);
  if (!activeStep) {
    return error(ErrorCode.E_STATE_CONFLICT, '대기 중인 결재 단계가 없습니다.');
  }
  if (activeStep.approverId !== user.id) {
    return error(ErrorCode.E_FORBIDDEN, '본인 차례의 결재가 아닙니다.');
  }

  const isLast =
    approval.steps.filter((s) => s.status === StepStatus.PENDING).length === 1;

  let nextObjectState: ObjectState | null = null;
  if (isLast) {
    const t = canTransition(approval.revision.object.state, 'approve', { userId: user.id });
    if (!t.ok || !t.next) return error(ErrorCode.E_STATE_CONFLICT, t.message);
    nextObjectState = t.next;
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Mark this step approved.
    await tx.approvalStep.update({
      where: { id: activeStep.id },
      data: {
        status: StepStatus.APPROVED,
        comment: parsedBody.comment ?? null,
        signatureFile: parsedBody.signatureFile ?? null,
        actedAt: now,
      },
    });

    if (!isLast) {
      // Approval still in progress (more steps to act). Notify the next
      // pending approver — the requester gets the final APPROVE/REJECT
      // notification when the last step lands.
      const nextStep = approval.steps.find(
        (s) => s.status === StepStatus.PENDING && s.id !== activeStep.id,
      );
      if (nextStep && nextStep.approverId !== user.id) {
        await enqueueNotification(tx, {
          userId: nextStep.approverId,
          type: 'APPROVAL_REQUEST',
          title: '결재 차례가 되었습니다',
          body: approval.title,
          objectId: approval.revision.object.id,
          metadata: {
            approvalId: approval.id,
            requesterId: approval.requesterId,
          },
        });
      }

      return {
        approvalStatus: ApprovalStatus.PENDING,
        objectState: approval.revision.object.state,
      };
    }

    // Last step — approval complete.
    await tx.approval.update({
      where: { id: approval.id },
      data: { status: ApprovalStatus.APPROVED, completedAt: now },
    });

    const obj = approval.revision.object;
    const nextRev = obj.currentRevision + 1;

    // Create the next Revision row so subsequent checkins land on it.
    await tx.revision.upsert({
      where: { objectId_rev: { objectId: obj.id, rev: nextRev } },
      update: {},
      create: { objectId: obj.id, rev: nextRev },
    });

    await tx.objectEntity.update({
      where: { id: obj.id },
      data: {
        state: nextObjectState!,
        currentRevision: nextRev,
        currentVersion: new Prisma.Decimal('0.0'),
        lockedById: null,
      },
    });

    // R29 / N-1 — notify the requester that the approval landed.
    if (approval.requesterId !== user.id) {
      await enqueueNotification(tx, {
        userId: approval.requesterId,
        type: 'APPROVAL_APPROVE',
        title: '결재가 승인되었습니다',
        body: `${obj.number} — ${approval.title}`,
        objectId: obj.id,
        metadata: {
          approvalId: approval.id,
          finalApproverId: user.id,
        },
      });
    }

    return {
      approvalStatus: ApprovalStatus.APPROVED,
      objectState: nextObjectState!,
    };
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'APPROVE',
    objectId: approval.revision.object.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      approvalId: approval.id,
      stepId: activeStep.id,
      isLast,
    },
  });

  return ok({
    approvalId: approval.id,
    stepId: activeStep.id,
    approvalStatus: result.approvalStatus,
    objectState: result.objectState,
  });
}

export const POST = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  approveHandler,
);
