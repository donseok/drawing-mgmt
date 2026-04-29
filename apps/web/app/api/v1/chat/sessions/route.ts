// GET /api/v1/chat/sessions — caller's chat sessions, newest first.
//
// `limit` defaults to 20, max 50. Returns id/title/updatedAt + message count.

import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

async function handleGet(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }

  const rows = await prisma.chatSession.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    take: parsed.data.limit,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return ok({
    sessions: rows.map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updatedAt.toISOString(),
      messageCount: r._count.messages,
    })),
  });
}

export const GET = withApi({ rateLimit: 'none' }, handleGet);
