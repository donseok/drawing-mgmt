// POST /api/v1/notifications/read-all
//
// Mark every unread notification for the current user as read (R29 / N-1).
// Returns `updatedCount` so the FE can update its bell badge without a
// follow-up unread-count fetch.
//
// Owned by BE-2 — see `_workspace/api_contract.md` §3.3.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';

export async function POST(): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const result = await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  return ok({ updatedCount: result.count });
}
