// Next.js middleware — runs on Edge runtime.
//
// Responsibilities:
//   - Redirect unauthenticated users to /login (preserve callbackUrl).
//   - Redirect authenticated users away from /login → /.
//   - Skip auth for public assets, _next, favicon, /api/auth/*.
//   - DO NOT enforce auth on /api/v1/* here (each route handler calls
//     `getCurrentUser()` so it can also run permission/zod checks centrally).
//   - SEC-2 — attach CSP and friends to *every* response. We can't put CSRF
//     here because the in-memory rate limiter and the Origin check both want
//     access to the resolved user (only available in the Node runtime); they
//     live in `lib/api-helpers.ts` and are wired per-route.
//
// We import the Edge-safe config so Prisma never lands in the Edge bundle.

import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/auth.config';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const pathname = nextUrl.pathname;

  // BUG-20 — block dev-only routes (`/dev/*`, `/api/v1/dev/*`) in production.
  // These are utility pages (sample DWG ingest, etc.) that should never be
  // reachable on a production deployment.
  const isDevRoute =
    pathname.startsWith('/dev/') ||
    pathname === '/dev' ||
    pathname.startsWith('/api/v1/dev/');
  if (isDevRoute && process.env.NODE_ENV === 'production') {
    return applySecurityHeaders(
      NextResponse.rewrite(new URL('/not-found', nextUrl)),
    );
  }

  const isAuthPage = pathname === '/login' || pathname.startsWith('/login/');
  // R47 / FIND-003 — `/api/v1/attachments/*` is no longer demo-public; the
  // attachment routes themselves now call `requireAttachmentView` to gate
  // by folder permission + scan status. `/viewer/*` stays open ONLY in
  // non-production so the dev fixture demo still works without a DB; in
  // production the matcher below funnels into the requireLogin branch.
  const isDemoPublic =
    pathname === '/api/v1/health' ||
    (process.env.NODE_ENV !== 'production' && pathname.startsWith('/viewer/'));

  // Logged-in users hitting /login → bounce home.
  if (isAuthPage && isLoggedIn) {
    return applySecurityHeaders(
      NextResponse.redirect(new URL('/', nextUrl)),
    );
  }

  // Public auth pages and demo-public paths don't need auth.
  if (isAuthPage || isDemoPublic) {
    return applySecurityHeaders(NextResponse.next());
  }

  // Anything else under matcher: require login.
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', nextUrl);
    // Preserve original destination for post-login redirect.
    if (pathname !== '/') {
      loginUrl.searchParams.set('callbackUrl', pathname + nextUrl.search);
    }
    return applySecurityHeaders(NextResponse.redirect(loginUrl));
  }

  // Authenticated request — pass through, but stamp the headers.
  // R48 / FIND-005 — propagate the resolved pathname into a request header
  // so the (main)/layout RSC can decide whether to skip the password-expiry
  // redirect when the user is already on /settings (avoids redirect loops).
  // Edge → RSC header forwarding is the documented pattern in Next 14:
  //   NextResponse.next({ request: { headers: <new headers> } }).
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-pathname', pathname);
  return applySecurityHeaders(
    NextResponse.next({ request: { headers: reqHeaders } }),
  );
});

export const config = {
  // Match everything except API auth, _next assets, favicon, and files w/ extension.
  // (API v1 routes still go through middleware so unauthenticated browser
  // navigations to them get the same treatment, but the matcher excludes
  // static asset patterns to keep middleware fast.)
  matcher: ['/((?!api/auth|_next|favicon|.*\\..*).*)'],
};

// ── SEC-2 / SEC-3 helpers ────────────────────────────────────────────────

/**
 * SEC-2 — apply the project-wide security header set to a NextResponse.
 *
 * We intentionally allow `'unsafe-inline'` + `'unsafe-eval'` in
 * `script-src` for now — Next.js 14's RSC payload is inlined and dev mode
 * still uses `eval`. Tightening to nonces is queued as a follow-up
 * (per contract §5.2 — "Phase 2"). The DXF Web Worker requires
 * `worker-src 'self' blob:` — removing `blob:` will break the viewer, so
 * keep that line load-bearing.
 *
 * `frame-ancestors 'none'` + `X-Frame-Options: DENY` together cover both
 * modern (CSP-aware) and legacy browsers against clickjacking.
 */
function applySecurityHeaders(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  // R49 / FIND-021 — Strict-Transport-Security. Only emit in production:
  // a localhost dev server is plain http and HSTS would force the browser
  // into https for the whole `localhost` host (and subdomains) for a year.
  // 1y max-age + includeSubDomains is the OWASP-recommended baseline; we
  // intentionally leave `preload` off until the deploy domain is confirmed
  // and pre-loaded into the HSTS preload list (separate operational step).
  if (process.env.NODE_ENV === 'production') {
    res.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }
  return res;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
