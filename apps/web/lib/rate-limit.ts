// Simple in-memory rate limiter (fixed window).
//
// Production WARNING: this is per-process memory. With multiple Next.js
// instances or serverless cold starts, counts are not shared. Replace with
// Redis-backed implementation (e.g. ioredis INCR + EXPIRE) for prod.
// See TRD §8.1: 로그인 5회/분, API 100회/분.

interface Bucket {
  count: number;
  /** epoch ms when the bucket resets */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /** Seconds until reset (rounded up). */
  retryAfter: number;
}

export interface RateLimitOptions {
  /** Identifier — e.g. `login:${ip}` or `api:${userId}`. */
  key: string;
  /** Max requests per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

/**
 * Take one token from the bucket identified by `key`. Returns `allowed=false`
 * (with a `retryAfter` hint in seconds) when the limit is exceeded.
 *
 * Includes a cheap inline GC: every ~60 s we sweep expired buckets.
 */
export function rateLimit(opts: RateLimitOptions): RateLimitResult {
  const { key, limit, windowSec } = opts;
  const now = Date.now();
  gc(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowSec * 1000;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt, retryAfter: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
    retryAfter: 0,
  };
}

/** Reset a key (e.g. on successful login to clear failed-attempt bucket). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

let lastGc = 0;
function gc(now: number): void {
  if (now - lastGc < 60_000) return;
  lastGc = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

export const RateLimitConfig = {
  /** TRD §8.1: 5 login attempts / minute per IP. */
  LOGIN: { limit: 5, windowSec: 60 },
  /** TRD §8.1: 100 API calls / minute per user. */
  API: { limit: 100, windowSec: 60 },
} as const;

/**
 * Extract the best-effort client IP from a Request — mirrors the rule used
 * by `extractRequestMeta` in lib/audit. Used as a rate-limit key when no
 * authenticated user is available.
 */
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

export interface RateLimitForRequestOpts {
  /**
   * Logical scope of the limit — keeps `chat:` counts and `api:` counts in
   * separate buckets so a route that already had a chat-specific bucket
   * doesn't double-count when wrapped by `withApi` later.
   */
  scope?: string;
  /** Override the bucket size. Defaults to RateLimitConfig.API. */
  config?: { limit: number; windowSec: number };
  /** Authenticated user id — preferred bucket key when present. */
  userId?: string | null;
}

/**
 * Helper: pick the right bucket for a request and call `rateLimit`.
 * Authenticated users get `${scope}:user:${userId}`; unauthenticated requests
 * fall back to `${scope}:ip:${ip}` (mostly defensive — most v1 routes also
 * call `requireUser`, so the ip bucket only protects login/health/etc.).
 */
export function rateLimitForRequest(
  req: Request,
  opts: RateLimitForRequestOpts = {},
): RateLimitResult {
  const scope = opts.scope ?? 'api';
  const config = opts.config ?? RateLimitConfig.API;
  const subject = opts.userId
    ? `user:${opts.userId}`
    : `ip:${clientIp(req)}`;
  return rateLimit({ key: `${scope}:${subject}`, ...config });
}
