// GET /api/v1/approvals?box=waiting|done|sent|recall|trash
//
// Inboxes (TRD §6.2):
//   waiting — approvals where the current user has a WAITING step that is
//             the active (lowest-order WAITING) step for an IN_PROGRESS approval.
//   done    — approvals where the current user has any acted step
//             (APPROVED or REJECTED).
//   sent    — approvals requested by the current user that are still active
//             or have terminated normally (IN_PROGRESS / APPROVED / REJECTED).
//   recall  — approvals requested by the current user that were CANCELLED
//             (회수). Distinct from `sent` so the FE can render a dedicated tab.
//   trash   — approvals on objects that were soft-deleted (legacy alias).
//
// On first request, if the Approval table is empty, a tiny demo seed is
// inserted so the FE can render something useful out-of-the-box. The seed
// is idempotent — once any rows exist, the inline-seed branch is skipped.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApprovalStatus, ObjectState, StepStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { ensureApprovalDemoSeed } from '@/lib/demo-seed';

const querySchema = z.object({
  box: z.enum(['waiting', 'done', 'sent', 'recall', 'trash']).default('waiting'),
});

export async function GET(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    box: url.searchParams.get('box') ?? 'waiting',
  });
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { box } = parsed.data;

  const baseInclude = {
    requester: { select: { id: true, username: true, fullName: true } },
    steps: {
      orderBy: { order: 'asc' as const },
      include: {
        approver: { select: { id: true, username: true, fullName: true } },
      },
    },
    revision: {
      include: {
        object: {
          select: {
            id: true,
            number: true,
            name: true,
            state: true,
            folderId: true,
            deletedAt: true,
          },
        },
      },
    },
  };

  // First-call demo seed (no-op if any Approval rows already exist).
  await ensureApprovalDemoSeed();

  if (box === 'sent') {
    const data = await prisma.approval.findMany({
      where: {
        requesterId: user.id,
        status: {
          in: [
            ApprovalStatus.IN_PROGRESS,
            ApprovalStatus.APPROVED,
            ApprovalStatus.REJECTED,
            ApprovalStatus.PENDING,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: baseInclude,
    });
    return ok(data);
  }

  if (box === 'recall') {
    const data = await prisma.approval.findMany({
      where: {
        requesterId: user.id,
        status: ApprovalStatus.CANCELLED,
      },
      orderBy: { createdAt: 'desc' },
      include: baseInclude,
    });
    return ok(data);
  }

  if (box === 'trash') {
    const data = await prisma.approval.findMany({
      where: {
        revision: {
          object: { deletedAt: { not: null }, state: ObjectState.DELETED },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: baseInclude,
    });
    return ok(data);
  }

  if (box === 'done') {
    const data = await prisma.approval.findMany({
      where: {
        steps: {
          some: {
            approverId: user.id,
            status: { in: [StepStatus.APPROVED, StepStatus.REJECTED] },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: baseInclude,
    });
    return ok(data);
  }

  // waiting
  // Approvals that are IN_PROGRESS and where the current user has a WAITING
  // step at the *lowest* WAITING order (i.e. it's their turn).
  const candidates = await prisma.approval.findMany({
    where: {
      status: ApprovalStatus.IN_PROGRESS,
      steps: { some: { approverId: user.id, status: StepStatus.WAITING } },
    },
    include: baseInclude,
    orderBy: { createdAt: 'desc' },
  });

  const data = candidates.filter((a) => {
    const waitingOrders = a.steps
      .filter((s) => s.status === StepStatus.WAITING)
      .map((s) => s.order);
    if (waitingOrders.length === 0) return false;
    const minOrder = Math.min(...waitingOrders);
    return a.steps.some(
      (s) =>
        s.order === minOrder &&
        s.approverId === user.id &&
        s.status === StepStatus.WAITING,
    );
  });

  return ok(data);
}
