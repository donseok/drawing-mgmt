// GET /api/v1/approvals?box=waiting|done|sent|trash
//
// Inboxes (TRD §6.2):
//   waiting — approvals where the current user has a WAITING step that is
//             the active (lowest-order WAITING) step for an IN_PROGRESS approval.
//   done    — approvals where the current user has any acted step
//             (APPROVED or REJECTED).
//   sent    — approvals requested by the current user.
//   trash   — approvals on objects that were soft-deleted.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApprovalStatus, ObjectState, StepStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

const querySchema = z.object({
  box: z.enum(['waiting', 'done', 'sent', 'trash']).default('waiting'),
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

  if (box === 'sent') {
    const data = await prisma.approval.findMany({
      where: { requesterId: user.id },
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
