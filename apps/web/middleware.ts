// Next.js middleware — runs on Edge runtime.
//
// Responsibilities:
//   - Redirect unauthenticated users to /login (preserve callbackUrl).
//   - Redirect authenticated users away from /login → /.
//   - Skip auth for public assets, _next, favicon, /api/auth/*.
//   - DO NOT enforce auth on /api/v1/* here (each route handler calls
//     `getCurrentUser()` so it can also run permission/zod checks centrally).
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

  const isAuthPage = pathname === '/login' || pathname.startsWith('/login/');
  // DEV/DEMO: 뷰어와 health는 인증 없이 접근 허용 (DB 미가용 환경에서 샘플 fixture 시연 목적)
  // 운영 전 제거 또는 NODE_ENV 분기 강제.
  const isDemoPublic =
    pathname.startsWith('/viewer/') ||
    pathname === '/api/v1/health' ||
    pathname.startsWith('/api/v1/attachments/');

  // Logged-in users hitting /login → bounce home.
  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(new URL('/', nextUrl));
  }

  // Public auth pages and demo-public paths don't need auth.
  if (isAuthPage || isDemoPublic) return;

  // Anything else under matcher: require login.
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', nextUrl);
    // Preserve original destination for post-login redirect.
    if (pathname !== '/') {
      loginUrl.searchParams.set('callbackUrl', pathname + nextUrl.search);
    }
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  // Match everything except API auth, _next assets, favicon, and files w/ extension.
  // (API v1 routes still go through middleware so unauthenticated browser
  // navigations to them get the same treatment, but the matcher excludes
  // static asset patterns to keep middleware fast.)
  matcher: ['/((?!api/auth|_next|favicon|.*\\..*).*)'],
};
