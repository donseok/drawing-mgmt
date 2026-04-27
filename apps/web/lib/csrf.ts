// SEC-1 — same-origin assertion for state-changing requests.
//
// Cookie-based session auth is vulnerable to CSRF: a malicious site can
// trigger a `POST` from the user's browser, the cookie rides along, and the
// server can't tell the request apart from a legitimate one. The simplest
// (and Auth.js-recommended) defense for v1 is to verify that the `Origin`
// (or `Referer` fallback) of any mutating request matches our own host.
//
// This helper is deliberately *minimal*:
//   - GET/HEAD/OPTIONS bypass the check (idempotent).
//   - `Origin` is the source of truth. If absent (some legacy clients),
//     `Referer` is parsed.
//   - If both are absent, we reject — this is the conservative choice; the
//     same-origin browser fetches always populate `Origin` for cross-site
//     POST/PUT/PATCH/DELETE requests.
//   - Allowed origin = `process.env.NEXT_PUBLIC_BASE_URL` if set, else the
//     incoming request's own `host`/`x-forwarded-host` (so dev / preview
//     deployments don't need extra wiring).
//   - `/api/auth/*` is excluded — Auth.js handles its own CSRF token.
//
// Wire-up: routes call `assertSameOrigin(req)` early; we return a `Response`
// (forbidden envelope) on failure, so the handler can `if (csrf) return csrf;`.

import { error, ErrorCode } from '@/lib/api-response';
import type { NextResponse } from 'next/server';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Returns `null` if the request is allowed (or not a mutating request).
 * Returns a 403 NextResponse if the Origin/Referer is missing or mismatched.
 *
 * Callers:
 *
 *   const csrf = assertSameOrigin(req);
 *   if (csrf) return csrf;
 */
export function assertSameOrigin(req: Request): NextResponse | null {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return null;

  const url = new URL(req.url);
  // Auth.js owns its own CSRF — don't double-gate.
  if (url.pathname.startsWith('/api/auth/')) return null;

  const allowed = resolveAllowedOrigin(req);
  if (!allowed) {
    // Misconfiguration — surface as 403 rather than allow-by-default.
    return error(
      ErrorCode.E_FORBIDDEN,
      '서버 origin 설정이 누락되어 요청을 처리할 수 없습니다.',
    );
  }

  const claimed = pickClaimedOrigin(req);
  if (!claimed) {
    return error(
      ErrorCode.E_FORBIDDEN,
      'Origin 또는 Referer 헤더가 누락되어 요청을 거절했습니다.',
    );
  }

  if (!sameOrigin(claimed, allowed)) {
    return error(
      ErrorCode.E_FORBIDDEN,
      '요청 출처가 허용되지 않았습니다.',
    );
  }

  return null;
}

/**
 * Pick the origin we consider "ours". `NEXT_PUBLIC_BASE_URL` wins if set
 * (single canonical host in prod). Otherwise we trust the proxied host
 * headers — this is fine for the CSRF check because a real cross-site
 * attacker can't forge `Host` from inside the user's browser.
 */
function resolveAllowedOrigin(req: Request): string | null {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit && explicit.length > 0) {
    try {
      const parsed = new URL(explicit);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // Fall through to header-derived origin.
    }
  }

  const url = new URL(req.url);
  const forwardedHost =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const forwardedProto =
    req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  if (!forwardedHost) return null;
  return `${forwardedProto}://${forwardedHost}`;
}

/** Returns the request's claimed origin (`Origin` first, `Referer` fallback). */
function pickClaimedOrigin(req: Request): string | null {
  const origin = req.headers.get('origin');
  if (origin && origin !== 'null') return origin;

  const referer = req.headers.get('referer');
  if (!referer) return null;
  try {
    const u = new URL(referer);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && ua.host === ub.host;
  } catch {
    return false;
  }
}
