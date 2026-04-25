// POST /api/v1/notifications/:id/read
//
// Mark a notification as read. The product does not yet have a Notification
// table, and the schema is read-only for this PR (no migrations), so we
// implement this as a no-op success — the FE optimistically updates its
// cache, and that's good enough until a real table ships.
//
// We still validate that the underlying ActivityLog row exists and belongs to
// the current user so we don't lie to the FE about success on bogus IDs.
//
// Owned by BE-2.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

export async function POST(
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

  const log = await prisma.activityLog.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true },
  });
  if (!log) return error(ErrorCode.E_NOT_FOUND);
  if (log.userId !== user.id) return error(ErrorCode.E_FORBIDDEN);

  return ok({ id: params.id, read: true });
}
