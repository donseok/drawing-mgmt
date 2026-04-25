// GET /api/v1/notifications/unread-count
//
// Returns the unread notification count for the bell badge in the header
// (BUG-012). Until a real Notification table exists we approximate "unread"
// as "ActivityLog rows for this user in the last 24 hours" — small enough to
// be useful, bounded so the badge never flashes a huge number.
//
// Response shape: a bare integer (api-client unwraps `data` so the FE sees
// `number`).
//
// Owned by BE-2.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';

const WINDOW_HOURS = 24;
const MAX_COUNT = 99;

export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);
  const raw = await prisma.activityLog.count({
    where: { userId: user.id, createdAt: { gte: since } },
  });

  // Cap so the bell badge never has to render a 4-digit number.
  return ok(Math.min(raw, MAX_COUNT));
}
