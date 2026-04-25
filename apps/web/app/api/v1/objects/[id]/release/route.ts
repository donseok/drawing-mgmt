// POST /api/v1/objects/:id/release
//
// CHECKED_IN → IN_APPROVAL. Creates an Approval bound to the current
// Revision plus N ApprovalSteps.
//
// Body:
//   {
//     title: string,
//     approvers: [{ userId, order }, ...]   // ordered list (1..N)
//   }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ObjectState, ApprovalStatus, StepStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  toPermissionUser,
  loadFolderPermissions,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { canTransition } from '@/lib/state-machine';
import { extractRequestMeta, logActivity } from '@/lib/audit';

const releaseSchema = z.object({
  title: z.string().min(1).max(200),
  approvers: z
    .array(
      z.object({
        userId: z.string().min(1),
        order: z.number().int().min(1),
      }),
    )
    .min(1),
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
  const parsed = releaseSchema.safeParse(body);
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const dto = parsed.data;

  // Validate approver order — 1..N strictly increasing, no duplicates.
  const sorted = [...dto.approvers].sort((a, b) => a.order - b.order);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.order !== i + 1) {
      return error(
        ErrorCode.E_VALIDATION,
        '결재선의 순서는 1부터 연속이어야 합니다.',
      );
    }
  }

  const obj = await prisma.objectEntity.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      folderId: true,
      ownerId: true,
      securityLevel: true,
      state: true,
      lockedById: true,
      currentRevision: true,
    },
  });
  if (!obj) return error(ErrorCode.E_NOT_FOUND);

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);
  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions([obj.folderId]),
  ]);
  const decision = canAccess(pUser, obj, perms, 'EDIT');
  if (!decision.allowed) return error(ErrorCode.E_FORBIDDEN, decision.reason);

  const t = canTransition(obj.state, 'release', {
    lockedById: obj.lockedById,
    userId: user.id,
  });
  if (!t.ok) return error(ErrorCode.E_STATE_CONFLICT, t.message);

  // Verify all approvers exist.
  const approverIds = sorted.map((a) => a.userId);
  const approverUsers = await prisma.user.findMany({
    where: { id: { in: approverIds } },
    select: { id: true },
  });
  if (approverUsers.length !== approverIds.length) {
    return error(ErrorCode.E_VALIDATION, '존재하지 않는 결재자가 포함되어 있습니다.');
  }

  const result = await prisma.$transaction(async (tx) => {
    // Locate (or create) the current Revision.
    let revision = await tx.revision.findUnique({
      where: {
        objectId_rev: { objectId: obj.id, rev: obj.currentRevision },
      },
    });
    if (!revision) {
      revision = await tx.revision.create({
        data: { objectId: obj.id, rev: obj.currentRevision },
      });
    }

    // Approval is unique per Revision — reject if one already exists.
    const existing = await tx.approval.findUnique({
      where: { revisionId: revision.id },
    });
    if (existing) {
      throw new Error('APPROVAL_EXISTS');
    }

    const approval = await tx.approval.create({
      data: {
        revisionId: revision.id,
        title: dto.title,
        status: ApprovalStatus.IN_PROGRESS,
        requesterId: user.id,
        steps: {
          create: sorted.map((a) => ({
            approverId: a.userId,
            order: a.order,
            status: StepStatus.WAITING,
          })),
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    const updated = await tx.objectEntity.update({
      where: { id: obj.id },
      data: { state: ObjectState.IN_APPROVAL },
    });

    return { approval, object: updated };
  }).catch((err) => {
    if (err instanceof Error && err.message === 'APPROVAL_EXISTS') {
      return null;
    }
    throw err;
  });

  if (!result) {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      '이미 해당 리비전에 진행 중인 결재가 있습니다.',
    );
  }

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'OBJECT_RELEASE',
    objectId: obj.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { approvalId: result.approval.id },
  });

  return ok(result, undefined, { status: 201 });
}
