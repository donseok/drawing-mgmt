// GET /api/v1/objects/:id/activity?limit=50&cursor=<id>
//
// Paged activity log for a single object — checkout/checkin/approval/meta-edit
// events surface in the detail page's "활동" tab. Most recent first; cursor is
// the last seen ActivityLog id (createdAt desc, id desc for tie-break stability,
// matching the admin/audit pattern).
//
// Authorization: VIEW on the object (folder permission + securityLevel +
// owner-bypass via canAccess), same gate as GET /api/v1/objects/:id.
//
// Response shape — see _workspace/api_contract.md (R3c-1):
//   ok({ items: ActivityItem[], nextCursor: string | null })
// where ActivityItem = { id, action, actor: {id,username,fullName},
//                        ip, metadata, at }
//
// Owned by BE (R3c-1).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  toPermissionUser,
  loadFolderPermissions,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';

const querySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(200, Math.max(1, parseInt(v, 10) || 50)) : 50)),
});

export async function GET(
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

  // Resolve object first for the permission check (and to 404 cleanly).
  const obj = await prisma.objectEntity.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      folderId: true,
      ownerId: true,
      securityLevel: true,
    },
  });
  if (!obj) return error(ErrorCode.E_NOT_FOUND);

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);

  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions([obj.folderId]),
  ]);
  const decision = canAccess(pUser, obj, perms, 'VIEW');
  if (!decision.allowed) return error(ErrorCode.E_FORBIDDEN, decision.reason);

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { cursor, limit } = parsed.data;

  const where: Prisma.ActivityLogWhereInput = { objectId: obj.id };

  // Fetch limit+1 to detect hasMore. Order matches admin/audit for consistency.
  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      ipAddress: true,
      metadata: true,
      createdAt: true,
      user: { select: { id: true, username: true, fullName: true } },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;

  const items = page.map((r) => ({
    id: r.id,
    action: r.action,
    actor: {
      id: r.user.id,
      username: r.user.username,
      fullName: r.user.fullName,
    },
    ip: r.ipAddress,
    metadata: r.metadata,
    at: r.createdAt,
  }));

  return ok({ items, nextCursor });
}
