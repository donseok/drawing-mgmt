// SEC-1 + SEC-3 — single wrapper that bolts CSRF + rate limiting onto a
// Route Handler. Handlers stay readable: instead of duplicating the
// `assertSameOrigin` + `rateLimit` boilerplate at the top of every mutating
// route, they declare their needs once via `withApi(opts, handler)`.
//
//   export const POST = withApi({ rateLimit: 'api' }, async (req) => {
//     const user = await requireUser();          // unchanged
//     ...
//   });
//
// Why a wrapper (and not middleware):
//   - `requireUser()` already runs in every handler and gives us the userId
//     we want to key rate-limits on. Putting the limiter in middleware
//     would force a duplicate session lookup on the Edge runtime.
//   - The in-memory `rateLimit` map lives in the Node runtime; middleware
//     runs on Edge by default. Wrapping per-route keeps everything Node.
//   - Per-route opt-in lets us roll out gradually without breaking GET
//     traffic that doesn't need the gate.
//
// Wire-up in this round:
//   - PUT /api/v1/folders/:id/permissions  (new, U-5)
//   - POST /api/v1/admin/conversions/jobs/:id/retry  (new, V-INF-4 — owned by
//     viewer-engineer, so we leave hands off; they can opt in via the same
//     wrapper.)
//   - POST /api/v1/objects/bulk-create | bulk-move | bulk-copy | bulk-release
//   - POST /api/v1/chat (already had no limiter — wrap with scope='chat')
// Other routes will adopt this in subsequent rounds (search-and-replace).

import type { NextRequest, NextResponse } from 'next/server';
import { error, ErrorCode } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/csrf';
import {
  rateLimitForRequest,
  RateLimitConfig,
  type RateLimitResult,
} from '@/lib/rate-limit';
import { getCurrentUser } from '@/lib/auth-helpers';

export type WithApiHandler<Ctx> = (
  req: Request,
  ctx: Ctx,
) => Promise<NextResponse> | NextResponse;

export interface WithApiOptions {
  /**
   * Rate-limit policy:
   *   - `'api'`  — TRD §8.1 default (100/min/user). User key when
   *                authenticated, IP key otherwise.
   *   - `'chat'` — same numeric budget, separate scope so chat doesn't
   *                cannibalize the general API quota.
   *   - `'none'` — explicit opt-out.
   */
  rateLimit?: 'api' | 'chat' | 'none';
  /**
   * Skip the same-origin assertion. Default false — every mutating
   * request is checked. Use sparingly (webhooks, etc.).
   */
  skipCsrf?: boolean;
}

const DEFAULTS: Required<WithApiOptions> = {
  rateLimit: 'api',
  skipCsrf: false,
};

/**
 * Wrap a Route Handler with SEC-1 (Origin assertion) + SEC-3 (rate limit).
 *
 * Generic over the route's `ctx` argument so dynamic routes ({ params })
 * still type-check.
 */
export function withApi<Ctx = unknown>(
  options: WithApiOptions,
  handler: WithApiHandler<Ctx>,
): (req: NextRequest, ctx: Ctx) => Promise<NextResponse> {
  const opts = { ...DEFAULTS, ...options };
  return async (req, ctx) => {
    // 1) CSRF — fast, header-only, no DB.
    if (!opts.skipCsrf) {
      const csrfResp = assertSameOrigin(req);
      if (csrfResp) return csrfResp;
    }

    // 2) Rate limit — only for state-changing methods. GETs to wrapped
    //    handlers (rare but possible) bypass the bucket.
    if (opts.rateLimit !== 'none' && isMutating(req.method)) {
      const session = await getCurrentUser().catch(() => null);
      // R50 / FIND-013: rateLimitForRequest is now async (Redis-backed with
      // in-memory fallback). The await is on the request hot path but the
      // common case is a single Redis INCR (sub-millisecond on the same VPC).
      const result = await rateLimitForRequest(req, {
        scope: opts.rateLimit,
        userId: session?.id ?? null,
        config: RateLimitConfig.API,
      });
      if (!result.allowed) {
        return rateLimitResponse(result);
      }
    }

    return handler(req, ctx);
  };
}

function isMutating(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}

function rateLimitResponse(result: RateLimitResult): NextResponse {
  const resp = error(
    ErrorCode.E_RATE_LIMIT,
    '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  );
  resp.headers.set('Retry-After', String(result.retryAfter));
  resp.headers.set('X-RateLimit-Reset', String(Math.floor(result.resetAt / 1000)));
  return resp;
}
