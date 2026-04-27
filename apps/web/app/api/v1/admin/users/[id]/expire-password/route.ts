// POST /api/v1/admin/users/:id/expire-password — R40 / R39 finish.
//
// Force the target user's password to be considered expired so the next
// request bounces them through middleware → /change-password. Implementation
// is a single-column update — `passwordChangedAt = epoch 0` — which makes
// `isPasswordExpired()` (lib/password-policy.ts) trivially return true
// regardless of `PASSWORD_EXPIRY_DAYS`.
//
// We deliberately don't clear the password itself — admins can use
// /reset-password for that. "Expire" is the lighter intervention used when
// HR demands a rotation but the password is still valid (e.g. rumored
// compromise of an authenticator only).
//
// Authorization: SUPER_ADMIN or ADMIN. ADMIN cannot expire SUPER_ADMIN.
//
// Logs `USER_PASSWORD_EXPIRE` in ActivityLog with `targetUserId` metadata.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';

export const POST = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req: Request, { params }) => {
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
    if (!target || target.deletedAt) {
      return error(ErrorCode.E_NOT_FOUND);
    }
    if (actor.role === 'ADMIN' && target.role === 'SUPER_ADMIN') {
      return error(
        ErrorCode.E_FORBIDDEN,
        'SUPER_ADMIN 계정의 비밀번호는 ADMIN이 만료시킬 수 없습니다.',
      );
    }

    // epoch 0 — guaranteed to satisfy `isPasswordExpired` regardless of how
    // PASSWORD_EXPIRY_DAYS is tuned later. Using NULL would semantically
    // mean "never set" and is treated identically by isPasswordExpired,
    // but `passwordChangedAt` is NOT NULL in the schema so we have to use
    // a sentinel timestamp.
    await prisma.user.update({
      where: { id: target.id },
      data: { passwordChangedAt: new Date(0) },
    });

    const meta = extractRequestMeta(req);
    await logActivity({
      userId: actor.id,
      action: 'USER_PASSWORD_EXPIRE',
      objectId: null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { targetUserId: target.id },
    });

    return ok({ expired: true });
  },
);
