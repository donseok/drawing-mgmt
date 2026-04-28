// Edge-safe Auth.js v5 config — used by middleware.ts.
//
// IMPORTANT: this file MUST NOT import Prisma, bcrypt, or any node-only deps.
// Middleware runs on the Edge runtime where those won't load. The Credentials
// `authorize` function lives in `auth.ts` (Node runtime) where it can use
// PrismaClient and bcryptjs.
//
// See https://authjs.dev/guides/edge-compatibility

import type { NextAuthConfig } from 'next-auth';
import type { Role } from '@prisma/client';

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  // No providers here — the full Credentials provider is added in `auth.ts`.
  // For middleware, only `callbacks.authorized` runs and that needs no providers.
  providers: [],
  // R49 / FIND-009 — explicit `trustHost` so Auth.js v5 honors the configured
  // `NEXTAUTH_URL` (and request `Host` header) when running behind a reverse
  // proxy. Without this, v5 may reject requests whose host doesn't match an
  // inferred default and produce confusing 4xx in production.
  trustHost: true,
  // R49 / FIND-009 — only emit `Secure` cookies in production (HTTPS). In dev
  // (localhost http) Secure cookies would be silently dropped by browsers,
  // breaking sign-in. The flag matches what middleware/rewrites expect when
  // running behind a TLS-terminating proxy.
  useSecureCookies: process.env.NODE_ENV === 'production',
  session: {
    strategy: 'jwt',
    // 8h — TRD §5.1
    maxAge: 8 * 60 * 60,
  },
  callbacks: {
    /**
     * Called by middleware to gate access. Returning `false` triggers a redirect
     * to `pages.signIn`. We let middleware handle the routing logic explicitly
     * (so we can preserve callbackUrl); here we just expose `auth` truthiness.
     */
    authorized({ auth }) {
      return !!auth?.user;
    },
    /**
     * Persist user fields on the JWT. Runs on every request (in middleware too)
     * so we keep this lean — the heavy DB lookup happens once in `auth.ts`'s
     * `authorize` and is read from the token thereafter.
     */
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.role = user.role;
        token.securityLevel = user.securityLevel;
        token.organizationId = user.organizationId;
      }
      return token;
    },
    /**
     * Project the JWT onto the Session object exposed to server/client code.
     */
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.role = token.role as Role;
        session.user.securityLevel = token.securityLevel as number;
        session.user.organizationId = token.organizationId as string | null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
