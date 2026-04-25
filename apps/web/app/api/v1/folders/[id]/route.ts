// GET /api/v1/folders/:id — single folder with immediate children + ancestor crumbs.
//
// Response: ok(folder, { objectCount, children, path })
//   folder      — the requested folder (with defaultClass + parent)
//   meta.objectCount — non-deleted objects directly under this folder
//   meta.children    — immediate children (visible to this user)
//   meta.path        — breadcrumb from root → this folder (each: { id, name, folderCode })
//
// VIEW_FOLDER permission required for the requested folder. Children are
// further filtered by the same rule. Path crumbs are returned in full so the
// UI can render them even if the user lacks VIEW_FOLDER on a remote ancestor
// (their existence is implied by the visible target — no permission leak).

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  toPermissionUser,
  loadFolderPermissions,
  filterVisibleFolders,
} from '@/lib/permissions';
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

  // Object count + children + crumbs in parallel.
  const [objectCount, childRows, allFolders] = await Promise.all([
    prisma.objectEntity.count({
      where: { folderId: folder.id, deletedAt: null },
    }),
    prisma.folder.findMany({
      where: { parentId: folder.id },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        parentId: true,
        name: true,
        folderCode: true,
        defaultClassId: true,
        sortOrder: true,
        _count: { select: { objects: { where: { deletedAt: null } } } },
      },
    }),
    // Need the full set to walk ancestors — schema doesn't store materialized path.
    prisma.folder.findMany({
      select: { id: true, parentId: true, name: true, folderCode: true },
    }),
  ]);

  // Filter children by VIEW_FOLDER for this user.
  const visibleChildIds = await filterVisibleFolders({
    user: fullUser,
    folderIds: childRows.map((c) => c.id),
  });
  const children = childRows
    .filter((c) => visibleChildIds.has(c.id))
    .map((c) => ({
      id: c.id,
      parentId: c.parentId,
      name: c.name,
      folderCode: c.folderCode,
      defaultClassId: c.defaultClassId,
      sortOrder: c.sortOrder,
      objectCount: c._count.objects,
    }));

  // Build breadcrumb path: root → ... → current.
  const byId = new Map(allFolders.map((f) => [f.id, f]));
  const path: Array<{ id: string; name: string; folderCode: string }> = [];
  let cur = byId.get(folder.id);
  while (cur) {
    path.unshift({ id: cur.id, name: cur.name, folderCode: cur.folderCode });
    if (!cur.parentId) break;
    cur = byId.get(cur.parentId);
  }

  return ok(folder, { objectCount, children, path });
}
