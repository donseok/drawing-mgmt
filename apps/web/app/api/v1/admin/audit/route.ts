// GET /api/v1/admin/audit?limit=&cursor=&userId=&action=
//
// Audit log feed (BUG-017 / FE-2). Most recent first. Optional filters by
// user and/or action code. Each row includes the actor's username + fullName
// so the FE can render the table without a join.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by BE-2.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

const querySchema = z.object({
  userId: z.string().min(1).optional(),
  action: z.string().min(1).max(64).optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(200, Math.max(1, parseInt(v, 10) || 50)) : 50)),
});

export async function GET(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
    return error(ErrorCode.E_FORBIDDEN);
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    userId: url.searchParams.get('userId') ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { userId, action, cursor, limit } = parsed.data;

  const where: Prisma.ActivityLogWhereInput = {
    ...(userId ? { userId } : {}),
    ...(action ? { action } : {}),
  };

  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      user: { select: { id: true, username: true, fullName: true } },
      object: { select: { id: true, number: true, name: true } },
    },
  });

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null;

  return ok(data, { nextCursor });
}
