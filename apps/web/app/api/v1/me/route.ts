// GET /api/v1/me — current user profile (no passwordHash) + org + groups.
// PATCH /api/v1/me — update profile (fullName, email).
// Used by the client app shell (avatar, role gating, etc.).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

export async function GET(): Promise<NextResponse> {
  let session;
  try {
    session = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    include: {
      organization: {
        select: { id: true, name: true, parentId: true },
      },
      groups: {
        include: {
          group: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!user) return error(ErrorCode.E_NOT_FOUND, '사용자를 찾을 수 없습니다.');

  // Strip the password hash before serializing.
  const { passwordHash: _omit, groups, ...rest } = user;

  return ok({
    ...rest,
    groups: groups.map((ug) => ug.group),
  });
}

// ─────────────────────────────────────────────────────────────
// PATCH /api/v1/me — update profile fields
// ─────────────────────────────────────────────────────────────

const patchProfileSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  email: z.string().email().max(255).optional(),
}).refine((data) => data.fullName !== undefined || data.email !== undefined, {
  message: '수정할 필드가 하나 이상 필요합니다.',
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

  const parsed = patchProfileSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      '입력값이 유효하지 않습니다.',
      400,
      parsed.error.flatten(),
    );
  }

  const { fullName, email } = parsed.data;

  const updated = await prisma.user.update({
    where: { id: session.id },
    data: {
      ...(fullName !== undefined ? { fullName } : {}),
      ...(email !== undefined ? { email } : {}),
    },
    include: {
      organization: {
        select: { id: true, name: true, parentId: true },
      },
      groups: {
        include: {
          group: { select: { id: true, name: true } },
        },
      },
    },
  });

  const { passwordHash: _omit, groups, ...rest } = updated;

  return ok({
    ...rest,
    groups: groups.map((ug) => ug.group),
  });
}
