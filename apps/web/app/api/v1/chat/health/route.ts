// GET /api/v1/chat/health
//
// Returns the chatbot mode/availability status (pgvector present, LLM
// reachable, embedding reachable, decision rag/rule, reason). The result is
// cached in-process for 30s so the FE chat panel + admin diagnostics can
// poll without hammering the upstream gateways.

import type { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { getChatHealth } from '@/lib/chat/health';

async function handleGet(): Promise<NextResponse> {
  try {
    await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  try {
    const status = await getChatHealth();
    return ok(status);
  } catch (err) {
    console.error('[chat/health] probe failed', err);
    return error(ErrorCode.E_INTERNAL, '챗봇 상태 확인에 실패했습니다.');
  }
}

export const GET = withApi({ rateLimit: 'none' }, handleGet);
