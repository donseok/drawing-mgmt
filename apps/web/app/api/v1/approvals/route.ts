// GET /api/v1/approvals?box=waiting|done|sent|recall|trash
//
// Inboxes (TRD §6.2):
//   waiting — approvals where the current user has a PENDING step that is
//             the active (lowest-order PENDING) step for a PENDING approval.
//   done    — approvals where the current user has any acted step
//             (APPROVED or REJECTED).
//   sent    — approvals requested by the current user that are still active
//             or have terminated normally (PENDING / APPROVED / REJECTED).
//   recall  — approvals requested by the current user that were CANCELLED
//             (회수). Distinct from `sent` so the FE can render a dedicated tab.
//   trash   — approvals on objects that were soft-deleted (legacy alias).
//
// R4a (F4-01/F4-02): The schema collapsed PENDING+IN_PROGRESS → PENDING and
// renamed StepStatus.WAITING → PENDING. "Currently being worked on" is no
// longer a status — it's derived from step state.
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
  /**
   * Cursor — last seen approval id from the previous page. The page advances
   * in `createdAt DESC, id DESC` order; the cursor is positioned just past
   * that row (Prisma `cursor` + `skip:1`).
   */
  cursor: z.string().optional(),
  /** Page size. Default 50; cap 200. */
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const DEFAULT_PAGE_SIZE = 50;

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
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { box, cursor, limit } = parsed.data;
  const take = limit ?? DEFAULT_PAGE_SIZE;
  const cursorOpts: { cursor?: { id: string }; skip?: number } = cursor
    ? { cursor: { id: cursor }, skip: 1 }
    : {};

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
            ApprovalStatus.PENDING,
            ApprovalStatus.APPROVED,
            ApprovalStatus.REJECTED,
          ],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: baseInclude,
      take,
      ...cursorOpts,
    });
    return ok(data);
  }

  if (box === 'recall') {
    const data = await prisma.approval.findMany({
      where: {
        requesterId: user.id,
        status: ApprovalStatus.CANCELLED,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: baseInclude,
      take,
      ...cursorOpts,
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: baseInclude,
      take,
      ...cursorOpts,
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: baseInclude,
      take,
      ...cursorOpts,
    });
    return ok(data);
  }

  // waiting — approvals where it's the user's turn (their step is the
  // lowest-order PENDING). The "lowest pending order" derivation can't be
  // expressed in pure Prisma, so we over-fetch by `take * 2` then JS-filter
  // to the active-for-me rows. Bounded read instead of the unbounded scan
  // we had before.
  const candidates = await prisma.approval.findMany({
    where: {
      status: ApprovalStatus.PENDING,
      steps: { some: { approverId: user.id, status: StepStatus.PENDING } },
    },
    include: baseInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take * 2,
    ...cursorOpts,
  });

  const data = candidates
    .filter((a) => {
      const pendingOrders = a.steps
        .filter((s) => s.status === StepStatus.PENDING)
        .map((s) => s.order);
      if (pendingOrders.length === 0) return false;
      const minOrder = Math.min(...pendingOrders);
      return a.steps.some(
        (s) =>
          s.order === minOrder &&
          s.approverId === user.id &&
          s.status === StepStatus.PENDING,
      );
    })
    .slice(0, take);

  return ok(data);
}
