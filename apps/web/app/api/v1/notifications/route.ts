// GET /api/v1/notifications
//
// Notifications feed for the current user (BUG-012 / FE-2). The product does
// not yet have a dedicated Notification table, so we synthesize a feed from
// `ActivityLog` rows where `userId = current user` (most recent first).
//
// All notifications are reported as unread for now. Mark-read is a no-op until
// a proper Notification table ships (deferred — schema is read-only here).
//
// Response shape (per row):
//   { id, type, title, body, ts, read }
//
// where `type` is the ActivityLog.action code (LOGIN, OBJECT_CHECKOUT, ...)
// and `title` / `body` are derived from the action + metadata.
//
// Owned by BE-2.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { activityLabel } from '@/lib/activity-labels';

const querySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(100, Math.max(1, parseInt(v, 10) || 30)) : 30)),
});

function bodyFor(action: string, objectId: string | null): string {
  if (objectId) return `대상 자료 #${objectId.slice(-6)}`;
  return activityLabel(action);
}

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
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { limit } = parsed.data;

  const logs = await prisma.activityLog.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      objectId: true,
      createdAt: true,
    },
  });

  const data = logs.map((l) => ({
    id: l.id,
    type: l.action,
    title: activityLabel(l.action),
    body: bodyFor(l.action, l.objectId),
    ts: l.createdAt,
    read: false as const,
  }));

  return ok(data);
}
