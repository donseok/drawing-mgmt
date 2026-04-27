// POST /api/v1/notifications/:id/read
//
// Mark a notification as read for the current user (R29 / N-1).
//
// Owner-only — admins do NOT bypass; "read" is a per-user signal. Already-
// read rows are a no-op (we keep the original readAt to preserve audit).
//
// Owned by BE-2 — see `_workspace/api_contract.md` §3.2.

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

  const notification = await prisma.notification.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true, readAt: true },
  });
  if (!notification) return error(ErrorCode.E_NOT_FOUND);
  if (notification.userId !== user.id) return error(ErrorCode.E_FORBIDDEN);

  if (notification.readAt) {
    return ok({ id: notification.id, readAt: notification.readAt });
  }

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: { readAt: new Date() },
    select: { id: true, readAt: true },
  });

  return ok(updated);
}
