// GET /api/v1/notifications/unread-count
//
// Unread Notification rows for the current user (R29 / N-1). Drives the
// header bell badge. Capped at 99 so the badge never renders a 4-digit
// number — anything beyond is "99+" in the FE.
//
// Response shape:
//   { ok: true, data: { count: number } }
//
// Owned by BE-2 — see `_workspace/api_contract.md` §3.4.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';

const MAX_COUNT = 99;

export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const raw = await prisma.notification.count({
    where: { userId: user.id, readAt: null },
  });

  return ok({ count: Math.min(raw, MAX_COUNT) });
}
