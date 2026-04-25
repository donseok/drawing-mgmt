// GET /api/v1/objects/:id/approval
//
// Returns the union of all approvals across every revision of one object,
// split into:
//   - `current`: the most-recent PENDING approval (if any), or null
//   - `history`: all other approvals in created-desc order
//
// Used by the detail page "결재" tab (R3c-1). No pagination — one drawing
// rarely accumulates more than a handful of approvals.
//
// Authorization: VIEW on the object (same gate as GET /api/v1/objects/:id).
//
// Response shape — see _workspace/api_contract.md.
//
// Owned by BE (R3c-1).

import { NextResponse } from 'next/server';
import { ApprovalStatus, StepStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  toPermissionUser,
  loadFolderPermissions,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';

// Map Prisma StepStatus → contract step status. WAITING is the schema's
// pending-state name, but the contract surfaces it to the FE as 'PENDING'
// for symmetry with the approval-level status.
function stepStatusToContract(s: StepStatus): 'PENDING' | 'APPROVED' | 'REJECTED' {
  switch (s) {
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'WAITING':
    default:
      return 'PENDING';
  }
}

// The schema has IN_PROGRESS too (mid-approval), but the contract only lists
// PENDING/APPROVED/REJECTED/CANCELLED. IN_PROGRESS is conceptually still pending
// from the FE's perspective so we collapse it to 'PENDING'.
function approvalStatusToContract(
  s: ApprovalStatus,
): 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' {
  switch (s) {
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'PENDING':
    case 'IN_PROGRESS':
    default:
      return 'PENDING';
  }
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const obj = await prisma.objectEntity.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      folderId: true,
      ownerId: true,
      securityLevel: true,
    },
  });
  if (!obj) return error(ErrorCode.E_NOT_FOUND);

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);

  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions([obj.folderId]),
  ]);
  const decision = canAccess(pUser, obj, perms, 'VIEW');
  if (!decision.allowed) return error(ErrorCode.E_FORBIDDEN, decision.reason);

  // Fetch every approval whose revision belongs to this object. One query +
  // include — no N+1 over revisions or steps.
  const approvals = await prisma.approval.findMany({
    where: { revision: { objectId: obj.id } },
    orderBy: { createdAt: 'desc' },
    include: {
      requester: { select: { id: true, username: true, fullName: true } },
      revision: { select: { rev: true } },
      steps: {
        orderBy: { order: 'asc' },
        include: {
          approver: { select: { id: true, username: true, fullName: true } },
        },
      },
    },
  });

  const shape = (a: (typeof approvals)[number]) => ({
    id: a.id,
    title: a.title,
    status: approvalStatusToContract(a.status),
    revision: a.revision.rev,
    requestedBy: a.requester,
    requestedAt: a.createdAt,
    steps: a.steps.map((s) => ({
      order: s.order,
      approver: s.approver,
      status: stepStatusToContract(s.status),
      actedAt: s.actedAt,
      comment: s.comment,
    })),
  });

  // The "current" approval is the newest one still in flight. We treat both
  // PENDING and IN_PROGRESS as in-flight (collapsed to 'PENDING' in the shape).
  const inFlightIdx = approvals.findIndex(
    (a) => a.status === ApprovalStatus.PENDING || a.status === ApprovalStatus.IN_PROGRESS,
  );
  const current = inFlightIdx === -1 ? null : shape(approvals[inFlightIdx]!);
  const history = approvals
    .filter((_, i) => i !== inFlightIdx)
    .map(shape);

  return ok({ current, history });
}
