// POST /api/v1/chat — Chat turn handler.
//
// Replaces the BUG-019 stub with the full RAG/Rule pipeline. The orchestrator
// (lib/chat/orchestrator.ts) handles session creation, retrieval, LLM
// invocation, tool execution and persistence. This route is a thin shell:
// auth + zod parse + own-session check + orchestrator.handleChatTurn.
//
// R36-polish: Accept negotiation —
//   - `application/x-ndjson` (or `text/event-stream`) → NDJSON stream of
//     ChatStreamEvent (contract §2.2). meta → delta* → sources? → actions? →
//     done. Errors mid-stream surface as a single `error` event followed by
//     `done` so the FE reader closes cleanly.
//   - Anything else (default JSON) → original `{ data: { ... } }` envelope.
//     This preserves the vitest integration tests + existing client paths.
//
// Wrapped with `withApi({ rateLimit: 'chat' })` so chat usage doesn't burn
// the user's general API quota (and vice versa). CSRF Origin/Referer match
// is automatically enforced by the wrapper. The wrapper passes through any
// `Response` we return, so the streaming path is unaffected.

import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import {
  handleChatTurn,
  handleChatTurnStream,
  SessionNotFoundError,
} from '@/lib/chat/orchestrator';

const bodySchema = z.object({
  sessionId: z.string().cuid().optional(),
  message: z.string().min(1).max(4000),
});

function wantsStreamingResponse(req: Request): boolean {
  const accept = req.headers.get('accept') ?? '';
  return accept.includes('application/x-ndjson') || accept.includes('text/event-stream');
}

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

  const memberships = await prisma.userGroup.findMany({
    where: { userId: user.id },
    select: { groupId: true },
  });
  const userCtx = {
    id: user.id,
    role: user.role,
    securityLevel: user.securityLevel,
    organizationId: user.organizationId,
    groupIds: memberships.map((m) => m.groupId),
  };

  if (wantsStreamingResponse(req)) {
    // NextResponse extends Response — both share the (body, init) constructor
    // and Next.js's runtime accepts a plain Response from a Route Handler.
    // The cast keeps `withApi`'s declared `Promise<NextResponse>` happy.
    return streamingResponse({
      user: userCtx,
      message: parsed.data.message,
      sessionId: parsed.data.sessionId,
    }) as NextResponse;
  }

  // Legacy JSON envelope — kept for vitest integration + non-stream clients.
  try {
    const result = await handleChatTurn({
      user: userCtx,
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

interface StreamingArgs {
  user: {
    id: string;
    role: string;
    securityLevel: number;
    organizationId: string | null;
    groupIds: string[];
  };
  message: string;
  sessionId: string | undefined;
}

function streamingResponse(args: StreamingArgs): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const writeEvent = (evt: unknown) => {
        controller.enqueue(enc.encode(JSON.stringify(evt) + '\n'));
      };
      try {
        const gen = handleChatTurnStream({
          user: args.user,
          message: args.message,
          sessionId: args.sessionId,
        });
        for await (const evt of gen) {
          writeEvent(evt);
        }
      } catch (err) {
        if (err instanceof SessionNotFoundError) {
          writeEvent({
            type: 'error',
            code: 'E_NOT_FOUND',
            message: '세션을 찾을 수 없습니다.',
          });
        } else {
          console.error('[chat/stream] generator failed', err);
          writeEvent({
            type: 'error',
            code: 'E_INTERNAL',
            message: '챗봇 응답 생성에 실패했습니다.',
          });
        }
        // Always emit a terminal `done` so the FE reader closes cleanly.
        writeEvent({ type: 'done' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

export const POST = withApi({ rateLimit: 'chat' }, handlePost);
