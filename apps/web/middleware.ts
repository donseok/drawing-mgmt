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
//   - R-CSP / FIND-015 — generate a per-request nonce and forward it via
//     `x-nonce` request header so RSC can stamp it onto next-themes inline
//     script. CSP `script-src` now uses `'nonce-{X}' 'strict-dynamic'`
//     instead of `'unsafe-inline'`. Dev keeps `'unsafe-eval'` for HMR.
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

  // R-CSP — fresh nonce per request. Edge runtime guarantees `crypto` and
  // `crypto.randomUUID()` are available without extra imports. UUID v4 yields
  // 122 bits of entropy which is well above the unguessability bar for CSP
  // nonces (the spec only requires "sufficient" entropy).
  const nonce = crypto.randomUUID();

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
      nonce,
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
      nonce,
    );
  }

  // Public auth pages and demo-public paths don't need auth.
  // Still propagate nonce so any RSC render gets a valid x-nonce header.
  if (isAuthPage || isDemoPublic) {
    const reqHeaders = new Headers(req.headers);
    reqHeaders.set('x-nonce', nonce);
    return applySecurityHeaders(
      NextResponse.next({ request: { headers: reqHeaders } }),
      nonce,
    );
  }

  // Anything else under matcher: require login.
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', nextUrl);
    // Preserve original destination for post-login redirect.
    if (pathname !== '/') {
      loginUrl.searchParams.set('callbackUrl', pathname + nextUrl.search);
    }
    return applySecurityHeaders(NextResponse.redirect(loginUrl), nonce);
  }

  // Authenticated request — pass through, but stamp the headers.
  // R48 / FIND-005 — propagate the resolved pathname into a request header
  // so the (main)/layout RSC can decide whether to skip the password-expiry
  // redirect when the user is already on /settings (avoids redirect loops).
  // Edge → RSC header forwarding is the documented pattern in Next 14:
  //   NextResponse.next({ request: { headers: <new headers> } }).
  // R-CSP — same channel carries the per-request nonce for next-themes.
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-pathname', pathname);
  reqHeaders.set('x-nonce', nonce);
  return applySecurityHeaders(
    NextResponse.next({ request: { headers: reqHeaders } }),
    nonce,
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
 * SEC-2 / R-CSP — apply the project-wide security header set to a NextResponse.
 *
 * `script-src` uses a per-request nonce + `'strict-dynamic'`, which lets the
 * single nonce-stamped Next.js bootstrap script propagate trust to every
 * chunk it dynamically loads (RSC payload, app chunks, swagger CDN). In dev
 * we additionally allow `'unsafe-eval'` because Next.js 14 HMR uses `eval()`
 * for fast-refresh module replacement — this is removed in production.
 *
 * `style-src 'unsafe-inline'` is intentionally kept for now: 21 React inline
 * `style={...}` props + Tailwind runtime depend on it. Tightening style-src
 * is queued as Phase 2 (separate round).
 *
 * The DXF Web Worker requires `worker-src 'self' blob:` — removing `blob:`
 * will break the viewer, so keep that line load-bearing.
 *
 * `frame-ancestors 'none'` + `X-Frame-Options: DENY` together cover both
 * modern (CSP-aware) and legacy browsers against clickjacking.
 */
function applySecurityHeaders(res: NextResponse, nonce: string): NextResponse {
  res.headers.set('Content-Security-Policy', buildCsp(nonce));
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
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

/**
 * R-CSP — build the CSP string with the request's nonce woven into
 * `script-src`. Production drops `'unsafe-inline'` and `'unsafe-eval'`; dev
 * keeps `'unsafe-eval'` only for HMR. `'strict-dynamic'` is what makes the
 * trust transitive from the nonce-stamped bootstrap to its dynamically
 * loaded dependencies.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    isDev ? "'unsafe-eval'" : null,
  ]
    .filter(Boolean)
    .join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://cdn.jsdelivr.net",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
