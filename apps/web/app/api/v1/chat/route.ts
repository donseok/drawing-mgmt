// POST /api/v1/chat
//
// Chat stub (BUG-019). Real RAG/Rule pipeline lives in `lib/chat/*` and is
// wired up separately. For now the endpoint returns a canned response so the
// FE chat panel can render an end-to-end round-trip.
//
// Body: { message: string }
// Response: { response: string }
//
// Owned by BE-2.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
});

const CANNED_RESPONSE =
  'AI 챗봇 백엔드는 곧 연결됩니다. 현재는 기본 안내만 가능합니다.';

export async function POST(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  // user reference kept so future revisions can audit per-user usage.
  void user;

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

  return ok({ response: CANNED_RESPONSE });
}
