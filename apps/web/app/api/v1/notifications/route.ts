// GET /api/v1/notifications?cursor=&limit=&unreadOnly=
//
// Notifications feed for the current user (R29 / N-1).
//
// Reads the real `Notification` table (replaces the previous ActivityLog
// synthesis). Cursor pagination on `id` ordered by createdAt desc to keep
// the feed stable as new rows arrive. `unreadOnly=1` filters to readAt IS
// NULL.
//
// Response shape (per row):
//   { id, type, title, body, objectId, ts, read }
//
// `meta.unreadCount` is the user's total unread count regardless of cursor
// page (so the FE can keep the bell badge in sync without a second call).
//
// Owned by BE-2 — see `_workspace/api_contract.md` §3.1.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(100, Math.max(1, parseInt(v, 10) || 30)) : 30)),
  unreadOnly: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export async function GET(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    unreadOnly: url.searchParams.get('unreadOnly') ?? undefined,
  });
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { cursor, limit, unreadOnly } = parsed.data;

  const where = unreadOnly
    ? { userId: user.id, readAt: null }
    : { userId: user.id };

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        objectId: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({
      where: { userId: user.id, readAt: null },
    }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  const data = page.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    objectId: n.objectId,
    ts: n.createdAt,
    read: n.readAt !== null,
  }));

  return ok(data, { nextCursor, unreadCount });
}
