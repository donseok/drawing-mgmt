// POST /api/v1/objects/bulk-move
//
// R17 — move N objects to a new folder. Per-row authorization (EDIT on the
// destination folder + EDIT on the source object). Partial failure allowed
// so a single bad row doesn't roll back the others.
//
// Body:
//   { ids: string[] (1..200), targetFolderId: string }
//
// Response:
//   { successes: [{ id }], failures: [{ id, code, message }] }
//
// Owned by BE (R17).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ObjectState } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  loadFolderPermissions,
  toPermissionUser,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import type { ApiErrorCode } from '@/lib/api-errors';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';

const MAX_BATCH = 200;

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(MAX_BATCH),
  targetFolderId: z.string().min(1),
});

interface SuccessRow {
  id: string;
}
interface FailureRow {
  id: string;
  code: ApiErrorCode;
  message: string;
}

// SEC-1/3 — wrapped at module bottom (`export const POST = withApi(...)`).
async function handlePost(req: Request): Promise<NextResponse> {
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
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const { ids, targetFolderId } = parsed.data;
  const uniqueIds = Array.from(new Set(ids));

  // Verify destination folder exists. Permission check happens per-source
  // below (caller needs EDIT on both source and destination folders).
  const target = await prisma.folder.findUnique({
    where: { id: targetFolderId },
    select: { id: true },
  });
  if (!target) {
    return error(ErrorCode.E_VALIDATION, '대상 폴더를 찾을 수 없습니다.');
  }

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);
  const pUser = await toPermissionUser(fullUser);

  const objs = await prisma.objectEntity.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      folderId: true,
      ownerId: true,
      securityLevel: true,
      state: true,
      lockedById: true,
      number: true,
    },
  });
  const byId = new Map(objs.map((o) => [o.id, o]));

  // Load both source folders + destination so canAccess has every relevant
  // permission row in one query.
  const folderIds = Array.from(
    new Set([targetFolderId, ...objs.map((o) => o.folderId)]),
  );
  const perms = await loadFolderPermissions(folderIds);

  // Destination EDIT check is the same for every row — short-circuit if the
  // user can't write into the target at all.
  const destDecision = canAccess(
    pUser,
    { id: '', folderId: targetFolderId, ownerId: user.id, securityLevel: 5 },
    perms,
    'EDIT',
  );
  if (!destDecision.allowed) {
    return error(
      ErrorCode.E_FORBIDDEN,
      destDecision.reason ?? '대상 폴더에 쓰기 권한이 없습니다.',
    );
  }

  const meta = extractRequestMeta(req);
  const successes: SuccessRow[] = [];
  const failures: FailureRow[] = [];

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
    if (obj.folderId === targetFolderId) {
      // No-op move; treat as success so the FE can drop it from the selection.
      successes.push({ id: obj.id });
      continue;
    }
    if (
      obj.state === ObjectState.IN_APPROVAL ||
      obj.state === ObjectState.CHECKED_OUT
    ) {
      failures.push({
        id: obj.id,
        code: ErrorCode.E_STATE_CONFLICT,
        message: '결재중/체크아웃 상태에서는 이동할 수 없습니다.',
      });
      continue;
    }
    const decision = canAccess(pUser, obj, perms, 'EDIT');
    if (!decision.allowed) {
      failures.push({
        id: obj.id,
        code: ErrorCode.E_FORBIDDEN,
        message: decision.reason ?? '권한이 없습니다.',
      });
      continue;
    }
    try {
      await prisma.objectEntity.update({
        where: { id: obj.id },
        data: { folderId: targetFolderId },
      });
      await logActivity({
        userId: user.id,
        action: 'OBJECT_MOVE',
        objectId: obj.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          fromFolderId: obj.folderId,
          toFolderId: targetFolderId,
          bulk: true,
        },
      });
      successes.push({ id: obj.id });
    } catch (e) {
      failures.push({
        id: obj.id,
        code: ErrorCode.E_INTERNAL,
        message: e instanceof Error ? e.message : '알 수 없는 오류',
      });
    }
  }

  return ok({ successes, failures });
}

export const POST = withApi({ rateLimit: 'api' }, handlePost);
