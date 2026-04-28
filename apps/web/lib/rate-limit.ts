// R50 / FIND-013 — Redis-backed rate limiter (with in-memory fallback).
//
// Why Redis:
//   The previous in-memory `Map<string, Bucket>` only protects one Node
//   process. With multiple Next.js replicas (current docker-compose can scale
//   `web` horizontally) every replica had its own bucket, so an attacker
//   hitting the LB round-robin could effectively get N times the limit.
//
//   ioredis is already a runtime dep (BullMQ uses it), so this adds zero new
//   dependencies. We use the canonical INCR + EXPIRE-on-first-hit pattern:
//   one round-trip per request, atomic per-key, TTL self-cleans.
//
// Fallback:
//   If REDIS_URL is unset OR the connection isn't `ready` (initial dev
//   without Redis up, transient outage), we silently fall back to the
//   in-memory limiter. That keeps single-instance dev painless and avoids a
//   hard-fail if Redis is briefly unavailable in prod (better to over-allow
//   for a few seconds than 500 every request).
//
// Interface change:
//   `rateLimit()` and `rateLimitForRequest()` now return Promises. All
//   callers updated in the same patch (`auth.ts`, `lib/api-helpers.ts`).
//
// See TRD §8.1: 로그인 5회/분, API 100회/분.

import IORedis, { type Redis } from 'ioredis';

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

// ── Redis singleton ───────────────────────────────────────────────────────
//
// Three states:
//   - `null`         — not yet initialized; getRedis() will lazy-construct.
//   - Redis client   — initialized; check `.status === 'ready'` before use.
//   - 'unavailable'  — REDIS_URL missing or constructor threw; we never
//                       retry within a process lifetime (avoids reconnect
//                       loops thrashing the rate-limit hot path).

type RedisState = Redis | 'unavailable' | null;
let redisSingleton: RedisState = null;

function getRedis(): Redis | null {
  if (redisSingleton === 'unavailable') return null;
  if (redisSingleton) return redisSingleton;

  const url = process.env.REDIS_URL;
  if (!url) {
    redisSingleton = 'unavailable';
    return null;
  }

  try {
    const r = new IORedis(url, {
      // Rate limiting is on the request hot path — fail fast rather than
      // hold the request open while ioredis retries.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // We do NOT set lazyConnect — we want the connection to start
      // warming immediately on first import so the very first rate-limit
      // call has a chance of being `ready`.
      lazyConnect: false,
    });
    // Swallow connection errors so we degrade to in-memory rather than
    // unhandled-rejecting the process. The error fires on every reconnect
    // attempt; logging once is enough.
    let warned = false;
    r.on('error', (err) => {
      if (!warned) {
        warned = true;
        // eslint-disable-next-line no-console
        console.warn('[rate-limit] redis error, falling back to in-memory:', err.message);
      }
    });
    redisSingleton = r;
    return r;
  } catch {
    redisSingleton = 'unavailable';
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Take one token from the bucket identified by `key`. Returns `allowed=false`
 * (with a `retryAfter` hint in seconds) when the limit is exceeded.
 *
 * Tries Redis first; falls back to in-memory if Redis isn't reachable.
 */
export async function rateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const r = getRedis();
  if (!r || r.status !== 'ready') {
    return rateLimitInMemory(opts);
  }

  try {
    return await rateLimitRedis(r, opts);
  } catch (err) {
    // Don't fail the request just because Redis blipped — degrade gracefully.
    // eslint-disable-next-line no-console
    console.warn(
      '[rate-limit] redis op failed, falling back to in-memory for this request:',
      err instanceof Error ? err.message : String(err),
    );
    return rateLimitInMemory(opts);
  }
}

/**
 * Reset a key (e.g. on successful login to clear the failed-attempt bucket).
 *
 * Best-effort: deletes from both Redis (if reachable) and the in-memory map.
 */
export async function resetRateLimit(key: string): Promise<void> {
  buckets.delete(key);
  const r = getRedis();
  if (r && r.status === 'ready') {
    try {
      await r.del(`rl:${key}`);
    } catch {
      // ignore — best effort
    }
  }
}

// ── Redis impl ────────────────────────────────────────────────────────────

async function rateLimitRedis(
  r: Redis,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const { key, limit, windowSec } = opts;
  const redisKey = `rl:${key}`;

  // Atomic INCR — bucket is created at 1 if it didn't exist.
  const count = await r.incr(redisKey);
  // First hit in this window: arm the TTL. (PX wouldn't help here — second-
  // resolution is fine for a 60s window and matches resetRateLimit's grain.)
  if (count === 1) {
    await r.expire(redisKey, windowSec);
  }

  // Read TTL so we can return a precise `retryAfter`. -1 means no TTL set
  // (race with EXPIRE — re-arm). -2 means key missing (race with delete).
  let ttl = await r.ttl(redisKey);
  if (ttl < 0) {
    await r.expire(redisKey, windowSec);
    ttl = windowSec;
  }

  const allowed = count <= limit;
  const resetAt = Date.now() + ttl * 1000;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfter: allowed ? 0 : Math.max(1, ttl),
  };
}

// ── In-memory fallback (formerly `rateLimit`) ─────────────────────────────

/**
 * Fallback bucket implementation — used when Redis is unavailable.
 *
 * Includes a cheap inline GC: every ~60 s we sweep expired buckets.
 */
function rateLimitInMemory(opts: RateLimitOptions): RateLimitResult {
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
export async function rateLimitForRequest(
  req: Request,
  opts: RateLimitForRequestOpts = {},
): Promise<RateLimitResult> {
  const scope = opts.scope ?? 'api';
  const config = opts.config ?? RateLimitConfig.API;
  const subject = opts.userId
    ? `user:${opts.userId}`
    : `ip:${clientIp(req)}`;
  return rateLimit({ key: `${scope}:${subject}`, ...config });
}
