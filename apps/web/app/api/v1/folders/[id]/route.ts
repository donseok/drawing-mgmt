// GET /api/v1/folders/:id — single folder with object count.
//
// Returns folder metadata plus a `meta.objectCount` of non-deleted objects.
// VIEW_FOLDER permission required.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { canAccess, toPermissionUser, loadFolderPermissions } from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';

export async function GET(
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

  const folder = await prisma.folder.findUnique({
    where: { id: params.id },
    include: {
      defaultClass: { select: { id: true, code: true, name: true } },
      parent: { select: { id: true, name: true, folderCode: true } },
    },
  });
  if (!folder) return error(ErrorCode.E_NOT_FOUND);

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);

  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions([folder.id]),
  ]);
  const decision = canAccess(
    pUser,
    { id: '', folderId: folder.id, ownerId: '', securityLevel: 5 },
    perms,
    'VIEW_FOLDER',
  );
  if (!decision.allowed) return error(ErrorCode.E_FORBIDDEN, decision.reason);

  const objectCount = await prisma.objectEntity.count({
    where: { folderId: folder.id, deletedAt: null },
  });

  return ok(folder, { objectCount });
}
