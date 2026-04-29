// GET    /api/v1/chat/sessions/[id] — session metadata + ordered messages.
// DELETE /api/v1/chat/sessions/[id] — delete the session (own-only).
//
// Both endpoints enforce own-session: the session must exist AND
// session.userId === caller.id. Otherwise we return 404 (not 403) so the
// existence of someone else's session id can't be probed.

import type { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { deserializeAssistantMeta } from '@/lib/chat/orchestrator';
import type { ChatRole as PrismaChatRole } from '@prisma/client';

interface RouteCtx {
  params: { id: string };
}

async function handleGet(_req: Request, ctx: RouteCtx): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const session = await prisma.chatSession.findUnique({
    where: { id: ctx.params.id },
    select: {
      id: true,
      userId: true,
      title: true,
      updatedAt: true,
    },
  });
  if (!session || session.userId !== user.id) {
    return error(ErrorCode.E_NOT_FOUND, '세션을 찾을 수 없습니다.');
  }

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      content: true,
      mode: true,
      toolResults: true,
      createdAt: true,
    },
  });

  return ok({
    session: {
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt.toISOString(),
    },
    messages: messages.map((m) => {
      const { sources, actions } = deserializeAssistantMeta(m.toolResults);
      return {
        id: m.id,
        role: m.role as PrismaChatRole,
        content: m.content,
        mode: m.mode,
        createdAt: m.createdAt.toISOString(),
        ...(sources.length ? { sources } : {}),
        ...(actions.length ? { actions } : {}),
      };
    }),
  });
}

async function handleDelete(_req: Request, ctx: RouteCtx): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  // Verify ownership BEFORE delete so we don't hand back a misleading 404 vs.
  // 200 distinction.
  const session = await prisma.chatSession.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, userId: true },
  });
  if (!session || session.userId !== user.id) {
    return error(ErrorCode.E_NOT_FOUND, '세션을 찾을 수 없습니다.');
  }

  // Cascade configured at schema level — ChatMessage rows go too.
  await prisma.chatSession.delete({ where: { id: session.id } });

  return ok({ ok: true });
}

export const GET = withApi({ rateLimit: 'none' }, handleGet);
export const DELETE = withApi({ rateLimit: 'api' }, handleDelete);
