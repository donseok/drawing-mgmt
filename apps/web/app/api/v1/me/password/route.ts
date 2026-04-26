// PATCH /api/v1/me/password — change current user's password.
// Requires currentPassword verification via bcryptjs.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력해 주세요.'),
    newPassword: z
      .string()
      .min(8, '새 비밀번호는 최소 8자 이상이어야 합니다.')
      .max(256),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: '새 비밀번호는 현재 비밀번호와 달라야 합니다.',
    path: ['newPassword'],
  });

export async function PATCH(req: Request): Promise<NextResponse> {
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

  // Fetch the full user with passwordHash (not available on session).
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    return error(ErrorCode.E_NOT_FOUND, '사용자를 찾을 수 없습니다.');
  }

  // Verify current password.
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return error(
      ErrorCode.E_VALIDATION,
      '현재 비밀번호가 일치하지 않습니다.',
      400,
      { field: 'currentPassword', code: 'INVALID_CURRENT_PASSWORD' },
    );
  }

  // Hash and update.
  const hashed = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashed },
  });

  return ok({ message: '비밀번호가 변경되었습니다.' });
}
