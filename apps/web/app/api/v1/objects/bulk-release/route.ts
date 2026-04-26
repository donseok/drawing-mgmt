// POST /api/v1/objects/bulk-release
//
// F4-06 — bulk variant of POST /api/v1/objects/:id/release. Submits N
// objects to a *shared* approval line in one call. Each row is processed
// independently inside its own per-row transaction so a single bad row
// doesn't roll back the others — the FE gets a per-id success/failure
// breakdown that mirrors the F4-03 bulk-delete pattern.
//
// Body:
//   {
//     ids: string[],                              // 1..50 object ids
//     title: string,                              // shared title prefix
//     approvers: { userId: string; order: number }[]  // shared line, 1..N strict
//   }
//
// Response:
//   {
//     successes: [{ id: string; approvalId: string; objectState: ObjectState }],
//     failures:  [{ id: string; code: ErrorCode; message: string }]
//   }
//
// Top-level 200 even on partial failure — the body carries the breakdown.
// 4xx is reserved for malformed body / auth failure (the entire batch never
// ran).
//
// Owned by BE (R4c).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApprovalStatus,
  ObjectState,
  Prisma,
  StepStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  toPermissionUser,
  loadFolderPermissions,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import type { ApiErrorCode } from '@/lib/api-errors';
import { canTransition } from '@/lib/state-machine';
import { extractRequestMeta, logActivity } from '@/lib/audit';

const MAX_BATCH = 50;

const bulkReleaseSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(MAX_BATCH),
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

interface SuccessRow {
  id: string;
  approvalId: string;
  objectState: ObjectState;
}
interface FailureRow {
  id: string;
  code: ApiErrorCode;
  message: string;
}

export async function POST(req: Request): Promise<NextResponse> {
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
  const parsed = bulkReleaseSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const dto = parsed.data;

  // Approver order — 1..N strictly increasing, no duplicates. Same rule as
  // the single-row endpoint; validate once for the whole batch.
  const sortedApprovers = [...dto.approvers].sort((a, b) => a.order - b.order);
  for (let i = 0; i < sortedApprovers.length; i++) {
    if (sortedApprovers[i]!.order !== i + 1) {
      return error(
        ErrorCode.E_VALIDATION,
        '결재선의 순서는 1부터 연속이어야 합니다.',
      );
    }
  }

  // Verify all approver users exist once for the whole batch — failing fast
  // beats failing N times with the same error.
  const approverIds = sortedApprovers.map((a) => a.userId);
  const approverUsers = await prisma.user.findMany({
    where: { id: { in: approverIds }, deletedAt: null },
    select: { id: true },
  });
  if (approverUsers.length !== approverIds.length) {
    return error(
      ErrorCode.E_VALIDATION,
      '존재하지 않는 결재자가 포함되어 있습니다.',
    );
  }

  // Resolve current acting user (with role/securityLevel) once for the
  // permission check loop below.
  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);
  const pUser = await toPermissionUser(fullUser);

  // Fetch all candidate objects in one query.
  const uniqueIds = Array.from(new Set(dto.ids));
  const objs = await prisma.objectEntity.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      folderId: true,
      ownerId: true,
      securityLevel: true,
      state: true,
      lockedById: true,
      currentRevision: true,
      number: true,
    },
  });
  const byId = new Map(objs.map((o) => [o.id, o] as const));

  // One folder-permission lookup batches every distinct folderId we touch —
  // typical bulk releases hit ≤ a handful of folders so this stays cheap
  // even at MAX_BATCH.
  const folderIds = Array.from(new Set(objs.map((o) => o.folderId)));
  const perms = await loadFolderPermissions(folderIds);

  const meta = extractRequestMeta(req);
  const successes: SuccessRow[] = [];
  const failures: FailureRow[] = [];

  // Process each id sequentially. Parallel `$transaction` calls would race
  // on the per-revision approval uniqueness check; sequential keeps the audit
  // log ordered too.
  for (const id of uniqueIds) {
    const obj = byId.get(id);
    if (!obj) {
      failures.push({
        id,
        code: ErrorCode.E_NOT_FOUND,
        message: '대상 자료를 찾을 수 없습니다.',
      });
      continue;
    }

    const decision = canAccess(pUser, obj, perms, 'EDIT');
    if (!decision.allowed) {
      failures.push({
        id,
        code: ErrorCode.E_FORBIDDEN,
        message: decision.reason ?? '권한이 없습니다.',
      });
      continue;
    }

    const t = canTransition(obj.state, 'release', {
      lockedById: obj.lockedById,
      userId: user.id,
    });
    if (!t.ok) {
      failures.push({
        id,
        code: ErrorCode.E_STATE_CONFLICT,
        message: t.message ?? '상태가 결재상신 가능 상태가 아닙니다.',
      });
      continue;
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
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

        const existing = await tx.approval.findUnique({
          where: { revisionId: revision.id },
        });
        if (existing) {
          // Surface as a partial failure rather than throwing the whole batch.
          throw new BulkRowError(
            ErrorCode.E_STATE_CONFLICT,
            '이미 해당 리비전에 진행 중인 결재가 있습니다.',
          );
        }

        const approval = await tx.approval.create({
          data: {
            revisionId: revision.id,
            // Per-row title disambiguates inbox rows when N drawings share a
            // shared "공통 결재선" submit. The user's title is preserved as a
            // prefix so search still finds it.
            title: `${dto.title} (${obj.number})`,
            status: ApprovalStatus.PENDING,
            requesterId: user.id,
            steps: {
              create: sortedApprovers.map((a) => ({
                approverId: a.userId,
                order: a.order,
                status: StepStatus.PENDING,
              })),
            },
          },
        });

        await tx.objectEntity.update({
          where: { id: obj.id },
          data: { state: ObjectState.IN_APPROVAL },
        });

        return { approvalId: approval.id };
      });

      // Audit log lives outside the transaction so a slow log write doesn't
      // hold the row lock; the matching approval already exists by then.
      await logActivity({
        userId: user.id,
        action: 'OBJECT_RELEASE',
        objectId: obj.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { approvalId: created.approvalId, bulk: true },
      });

      successes.push({
        id: obj.id,
        approvalId: created.approvalId,
        objectState: ObjectState.IN_APPROVAL,
      });
    } catch (err) {
      if (err instanceof BulkRowError) {
        failures.push({ id: obj.id, code: err.code, message: err.message });
        continue;
      }
      // Unexpected DB error — surface a generic failure for this row but keep
      // the batch alive. The next id may still succeed.
      const message =
        err instanceof Prisma.PrismaClientKnownRequestError
          ? err.message
          : err instanceof Error
            ? err.message
            : '알 수 없는 오류';
      failures.push({
        id: obj.id,
        code: ErrorCode.E_INTERNAL,
        message,
      });
    }
  }

  return ok({ successes, failures });
}

class BulkRowError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BulkRowError';
  }
}
