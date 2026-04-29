// POST /api/v1/chat — Chat turn handler.
//
// Replaces the BUG-019 stub with the full RAG/Rule pipeline. The orchestrator
// (lib/chat/orchestrator.ts) handles session creation, retrieval, LLM
// invocation, tool execution and persistence. This route is a thin shell:
// auth + zod parse + own-session check + orchestrator.handleChatTurn.
//
// Wrapped with `withApi({ rateLimit: 'chat' })` so chat usage doesn't burn
// the user's general API quota (and vice versa). CSRF Origin/Referer match
// is automatically enforced by the wrapper.

import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { handleChatTurn, SessionNotFoundError } from '@/lib/chat/orchestrator';

const bodySchema = z.object({
  sessionId: z.string().cuid().optional(),
  message: z.string().min(1).max(4000),
});

async function handlePost(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }

  try {
    const result = await handleChatTurn({
      user: { id: user.id, role: user.role, securityLevel: user.securityLevel },
      message: parsed.data.message,
      sessionId: parsed.data.sessionId,
    });
    return ok(result);
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return error(ErrorCode.E_NOT_FOUND, '세션을 찾을 수 없습니다.');
    }
    console.error('[chat] turn failed', err);
    return error(ErrorCode.E_INTERNAL, '챗봇 응답 생성에 실패했습니다.');
  }
}

export const POST = withApi({ rateLimit: 'chat' }, handlePost);
