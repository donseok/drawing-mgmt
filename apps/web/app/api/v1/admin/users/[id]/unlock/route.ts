// POST /api/v1/admin/users/:id/unlock
//
// Reset failed-login counter and clear `lockedUntil` for a user. Used by
// admins to restore access after auto-lock (TRD §8.1: 5 fail / minute).
// Notifies the target user that the unlock happened.
//
// Authorization: SUPER_ADMIN or ADMIN. ADMIN cannot unlock a SUPER_ADMIN.
//
// Owned by BE-2 — see `_workspace/api_contract.md` §4.3.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { enqueueNotification } from '@/lib/notifications';
import { withApi } from '@/lib/api-helpers';

export const POST = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
  let actor;
  try {
    actor = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN') {
    return error(ErrorCode.E_FORBIDDEN);
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, role: true, deletedAt: true },
  });
  if (!target) return error(ErrorCode.E_NOT_FOUND);
  if (target.deletedAt) return error(ErrorCode.E_NOT_FOUND);
  if (actor.role === 'ADMIN' && target.role === 'SUPER_ADMIN') {
    return error(ErrorCode.E_FORBIDDEN, 'SUPER_ADMIN 계정은 ADMIN이 잠금 해제할 수 없습니다.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: target.id },
      data: { failedLoginCount: 0, lockedUntil: null },
      select: { id: true, failedLoginCount: true, lockedUntil: true },
    });
    // Skip self-notify (admin unlocking themselves is unlikely but possible).
    if (target.id !== actor.id) {
      await enqueueNotification(tx, {
        userId: target.id,
        type: 'USER_UNLOCK',
        title: '계정 잠금이 해제되었습니다',
        body: '관리자가 계정 잠금을 해제했습니다. 다시 로그인하여 사용해 주세요.',
        objectId: null,
        metadata: { actorId: actor.id },
      });
    }
    return u;
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: actor.id,
    action: 'USER_UNLOCK',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { targetUserId: target.id },
  });

  return ok(updated);
  },
);
