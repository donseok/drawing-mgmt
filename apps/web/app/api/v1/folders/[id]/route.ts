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
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  toPermissionUser,
  loadFolderPermissions,
  filterVisibleFolders,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  folderCode: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/, '폴더코드는 영문 대문자/숫자/_-만 허용합니다.')
    .optional(),
  parentId: z.string().min(1).nullable().optional(),
  defaultClassId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

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

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) {
    return error(ErrorCode.E_FORBIDDEN, '폴더 수정 권한이 없습니다.');
  }

  const folder = await prisma.folder.findUnique({
    where: { id: params.id },
    select: { id: true, parentId: true },
  });
  if (!folder) return error(ErrorCode.E_NOT_FOUND);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const dto = parsed.data;

  // Cycle guard: if parentId is being changed, the new parent must not be the
  // folder itself or any of its descendants.
  if (dto.parentId !== undefined && dto.parentId !== folder.parentId) {
    if (dto.parentId === folder.id) {
      return error(
        ErrorCode.E_VALIDATION,
        '폴더를 자기 자신의 하위로 이동할 수 없습니다.',
      );
    }
    if (dto.parentId) {
      // Walk up from the proposed parent — if we hit folder.id, this would
      // create a cycle. Materialize parent path with one query.
      const all = await prisma.folder.findMany({
        select: { id: true, parentId: true },
      });
      const byId = new Map(all.map((f) => [f.id, f]));
      let cur = byId.get(dto.parentId);
      while (cur) {
        if (cur.id === folder.id) {
          return error(
            ErrorCode.E_VALIDATION,
            '하위 폴더로의 이동은 허용되지 않습니다.',
          );
        }
        if (!cur.parentId) break;
        cur = byId.get(cur.parentId);
      }
    }
  }

  let updated;
  try {
    updated = await prisma.folder.update({
      where: { id: folder.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.folderCode !== undefined ? { folderCode: dto.folderCode } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.defaultClassId !== undefined
          ? { defaultClassId: dto.defaultClassId }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return error(ErrorCode.E_VALIDATION, '이미 사용 중인 폴더코드입니다.');
    }
    throw e;
  }

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'FOLDER_UPDATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { folderId: updated.id, fields: Object.keys(dto) },
  });

  return ok(updated);
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) {
    return error(ErrorCode.E_FORBIDDEN, '폴더 삭제 권한이 없습니다.');
  }

  const folder = await prisma.folder.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      folderCode: true,
      _count: {
        select: {
          objects: { where: { deletedAt: null } },
          children: true,
        },
      },
    },
  });
  if (!folder) return error(ErrorCode.E_NOT_FOUND);

  // Refuse if non-empty — children + active objects must be moved or deleted
  // first. Empty folder cleanup is the common case; recursive delete is
  // intentionally not implemented here to avoid accidental mass-loss.
  if (folder._count.objects > 0) {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      '폴더에 자료가 남아있어 삭제할 수 없습니다. 먼저 이동/삭제하세요.',
    );
  }
  if (folder._count.children > 0) {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      '하위 폴더가 존재해 삭제할 수 없습니다. 먼저 정리하세요.',
    );
  }

  await prisma.folder.delete({ where: { id: folder.id } });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'FOLDER_DELETE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { folderId: folder.id, name: folder.name, code: folder.folderCode },
  });

  return ok({ id: folder.id });
}
