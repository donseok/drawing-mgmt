// POST /api/v1/admin/users/:id/reset-password
//
// Admin-driven password reset. Two modes:
//
//   { tempPassword: '8~32자' }   → use the supplied plaintext.
//   { generate: true }           → BE generates a one-time temp password and
//                                  returns it once in the response (the only
//                                  time it is ever visible).
//
// Either mode also clears `failedLoginCount` and `lockedUntil` so the user
// can immediately log in. Notifies the target user that their password
// changed.
//
// Authorization: SUPER_ADMIN or ADMIN. ADMIN cannot reset SUPER_ADMIN.
//
// Owned by BE-2 — see `_workspace/api_contract.md` §4.4.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { enqueueNotification } from '@/lib/notifications';
import { withApi } from '@/lib/api-helpers';
// R48 / FIND-006 — admin-supplied temp passwords must satisfy the same
// length + complexity policy as user-driven changes. We deliberately do
// NOT run the history check here: this is the recovery path for a locked-
// out user, so the prior hash list isn't load-bearing.
import { validatePassword } from '@/lib/password-policy';

const BCRYPT_ROUNDS = 12;

// Discriminated union — exactly one of `tempPassword` or `generate` must be
// supplied. We validate by hand (Zod's discriminatedUnion needs a literal
// discriminator and these aren't structured that way in the spec).
const bodySchema = z.union([
  z.object({ tempPassword: z.string().min(8).max(32) }),
  z.object({ generate: z.literal(true) }),
]);

/** Generate a 16-character URL-safe token suitable as a temp password. */
function generateTempPassword(): string {
  // 12 bytes ≈ 16 base64 chars; trim to 16 and replace ambiguous chars.
  return randomBytes(12)
    .toString('base64')
    .replace(/\+/g, 'A')
    .replace(/\//g, 'B')
    .replace(/=/g, '')
    .slice(0, 16);
}

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
    return error(
      ErrorCode.E_FORBIDDEN,
      'SUPER_ADMIN 계정의 비밀번호는 ADMIN이 초기화할 수 없습니다.',
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }

  // Determine the plaintext temp password. If `generate=true` we generate
  // and surface it once; otherwise we use the supplied value and never
  // echo it back. Narrow on the discriminator-ish keys.
  const generated = 'generate' in parsed.data;
  const tempPassword = 'tempPassword' in parsed.data
    ? parsed.data.tempPassword
    : generateTempPassword();

  // R48 / FIND-006 — enforce the password policy on the *admin-supplied*
  // path. The generator we control (12-byte random base64url) is wide and
  // mixed-case so it always satisfies the policy; running validate on it
  // too costs nothing and keeps the contract uniform.
  const validation = validatePassword(tempPassword);
  if (!validation.ok) {
    return error(
      ErrorCode.E_VALIDATION,
      '임시 비밀번호가 정책을 만족하지 않습니다.',
      400,
      { errors: validation.errors },
    );
  }

  const hash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        passwordHash: hash,
        // R48 / FIND-006 — stamp the policy clock to the epoch so the next
        // (main)/layout RSC render forces the user through /settings to
        // pick a password of their own. Pairs with FIND-005 enforcement.
        passwordChangedAt: new Date(0),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    if (target.id !== actor.id) {
      await enqueueNotification(tx, {
        userId: target.id,
        type: 'USER_PASSWORD_RESET',
        title: '비밀번호가 초기화되었습니다',
        body: '관리자가 비밀번호를 초기화했습니다. 새 비밀번호로 로그인 후 즉시 변경해 주세요.',
        objectId: null,
        metadata: { actorId: actor.id, generated },
      });
    }
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: actor.id,
    action: 'USER_PASSWORD_RESET',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { targetUserId: target.id, generated },
  });

  // Only return the plaintext when WE generated it. When the admin supplied
  // it they already know what it is; echoing back would just expand its
  // exposure.
  if (generated) {
    return ok({ tempPassword });
  }
  return ok({});
  },
);
