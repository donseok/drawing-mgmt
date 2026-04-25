// GET /api/v1/me — current user profile (no passwordHash) + org + groups.
// Used by the client app shell (avatar, role gating, etc.).

import { NextResponse } from 'next/server';
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
