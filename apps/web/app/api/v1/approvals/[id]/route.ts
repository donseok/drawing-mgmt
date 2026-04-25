// GET /api/v1/approvals/:id
//
// Returns a single approval with its steps + linked revision/object summary,
// suitable for the right-side detail panel on the approval inbox screen.
//
// Authorization: any authenticated user that is either the requester or one
// of the step approvers can view; otherwise SUPER_ADMIN/ADMIN.
//
// Response shape (FE consumes via api-client which unwraps `data`):
//   {
//     id, title, status, createdAt, completedAt,
//     requester: { id, username, fullName },
//     steps: [{ id, order, status, comment, actedAt, approver: {...} }],
//     revision: { id, rev, object: { id, number, name, state, folderId } }
//   }
//
// Owned by BE-2.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

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

  const approval = await prisma.approval.findUnique({
    where: { id: params.id },
    include: {
      requester: { select: { id: true, username: true, fullName: true } },
      steps: {
        orderBy: { order: 'asc' },
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
              currentRevision: true,
              currentVersion: true,
            },
          },
        },
      },
    },
  });

  if (!approval) return error(ErrorCode.E_NOT_FOUND);

  // Visibility: requester, any step approver, or admin roles.
  const isPrivileged = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
  const isParticipant =
    approval.requesterId === user.id ||
    approval.steps.some((s) => s.approverId === user.id);
  if (!isPrivileged && !isParticipant) {
    return error(ErrorCode.E_FORBIDDEN);
  }

  return ok(approval);
}
