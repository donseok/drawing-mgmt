// PATCH /api/v1/me/password — change current user's password.
//
// R47 / FIND-002 — funnels through the shared R39 password policy
// (`validatePasswordWithHistory` + `buildPasswordChangeUpdate`) so the
// self-service path applies the same rules as admin reset:
//   - length ≥ 10, ≥ 3 of 4 character classes
//   - cannot reuse the current or last two historical hashes
//   - on success, history columns shift forward and `passwordChangedAt`
//     bumps so the 90-day expiry counter resets.
//
// Also wrapped with `withApi({ rateLimit: 'api' })` (FIND-001) and writes a
// PASSWORD_CHANGE_SELF activity log entry (FIND-018 prep).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import {
  validatePasswordWithHistory,
  buildPasswordChangeUpdate,
} from '@/lib/password-policy';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력해 주세요.'),
    newPassword: z.string().min(1).max(256),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: '새 비밀번호는 현재 비밀번호와 달라야 합니다.',
    path: ['newPassword'],
  });

export const PATCH = withApi({ rateLimit: 'api' }, async (req: Request) => {
  let session;
  try {
    session = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '잘못된 JSON 형식입니다.');
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      '입력값이 유효하지 않습니다.',
      400,
      parsed.error.flatten(),
    );
  }

  const { currentPassword, newPassword } = parsed.data;

  // Pull the current password row state — passwordHash + the two prev slots
  // are needed both for currentPassword verification and history-reuse
  // checking inside `validatePasswordWithHistory`.
  const fullUser = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      id: true,
      passwordHash: true,
      passwordPrev1Hash: true,
      passwordPrev2Hash: true,
    },
  });

  if (!fullUser) {
    return error(ErrorCode.E_NOT_FOUND, '사용자를 찾을 수 없습니다.');
  }

  // 1) Current password must match.
  const valid = await bcrypt.compare(currentPassword, fullUser.passwordHash);
  if (!valid) {
    return error(
      ErrorCode.E_VALIDATION,
      '현재 비밀번호가 일치하지 않습니다.',
      400,
      { field: 'currentPassword', code: 'INVALID_CURRENT_PASSWORD' },
    );
  }

  // 2) Policy + reuse — same rules as admin reset / create.
  const policy = await validatePasswordWithHistory(newPassword, [
    fullUser.passwordHash,
    fullUser.passwordPrev1Hash,
    fullUser.passwordPrev2Hash,
  ]);
  if (!policy.ok) {
    return error(
      ErrorCode.E_VALIDATION,
      '비밀번호 정책을 만족하지 않습니다.',
      400,
      { errors: policy.errors },
    );
  }

  // 3) Hash + history shift + passwordChangedAt bump.
  const newHash = await bcrypt.hash(newPassword, 12);
  const updateData = buildPasswordChangeUpdate(fullUser, newHash);
  await prisma.user.update({
    where: { id: fullUser.id },
    data: updateData,
  });

  // 4) Audit (FIND-018 prep).
  const meta = extractRequestMeta(req);
  await logActivity({
    userId: fullUser.id,
    action: 'PASSWORD_CHANGE_SELF',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return ok({ message: '비밀번호가 변경되었습니다.', changed: true });
});
