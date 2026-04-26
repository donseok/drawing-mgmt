// DELETE /api/v1/me/pins/:id
//
// Remove one of the current user's pins. The pin id is the same id returned
// by GET /api/v1/me/pins so the FE doesn't need to know which kind (folder
// vs object) it is — we look in both tables and 404 if neither owns it.
//
// Owned by BE (R7).

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const pinId = params.id;
  if (!pinId) return error(ErrorCode.E_VALIDATION, '핀 식별자가 필요합니다.');

  // Two cheap parallel reads beat sequencing. `userId` predicate also acts as
  // the authorization check — a pin owned by another user simply won't match.
  const [folderPin, objectPin] = await Promise.all([
    prisma.userFolderPin.findFirst({
      where: { id: pinId, userId: user.id },
      select: { id: true },
    }),
    prisma.userObjectPin.findFirst({
      where: { id: pinId, userId: user.id },
      select: { id: true },
    }),
  ]);

  if (folderPin) {
    await prisma.userFolderPin.delete({ where: { id: folderPin.id } });
    return ok({ id: folderPin.id, kind: 'folder' as const });
  }
  if (objectPin) {
    await prisma.userObjectPin.delete({ where: { id: objectPin.id } });
    return ok({ id: objectPin.id, kind: 'object' as const });
  }
  return error(ErrorCode.E_NOT_FOUND, '핀을 찾을 수 없습니다.');
}
