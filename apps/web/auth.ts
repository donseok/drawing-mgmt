// Auth.js v5 main configuration.
//
// This file runs on the Node runtime (uses Prisma + bcryptjs) and is imported
// by API route handlers (`/api/auth/[...nextauth]`) and any server-side code
// that calls `auth()`. The thin Edge-compatible config lives in `auth.config.ts`
// and is consumed by `middleware.ts`.
//
// Behavior:
//   - Credentials provider: username + password.
//   - bcrypt verification.
//   - Lockout: 5 failed attempts → 30-minute lock (User.lockedUntil).
//   - Successful login resets failedLoginCount + updates lastLoginAt.
//   - Session strategy: JWT (8h), HttpOnly cookie (Auth.js default).
//   - Custom Session/User/JWT shape augmented in types/next-auth.d.ts.
//
// See TRD §5.1.

import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { authConfig } from '@/auth.config';

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 min

// DEV/DEMO: in-memory test users for environments without DB (Postgres 미가용).
// `process.env.DEV_AUTH_FALLBACK !== 'false'` 일 때만 활성. 운영 시 false로 설정.
// 비밀번호는 평문 비교 (dev 한정). seed.ts 의 계정과 동기.
const DEV_USERS = [
  { username: 'admin',    password: 'admin123!',    fullName: '시스템관리자', role: 'SUPER_ADMIN', securityLevel: 1, organizationId: null },
  { username: 'manager',  password: 'manager123!',  fullName: '관리자',       role: 'ADMIN',       securityLevel: 2, organizationId: null },
  { username: 'kim',      password: 'kim123!',      fullName: '김철수',       role: 'USER',        securityLevel: 3, organizationId: null },
  { username: 'park',     password: 'park123!',     fullName: '박영호',       role: 'USER',        securityLevel: 3, organizationId: null },
  { username: 'lee',      password: 'lee123!',      fullName: '이민준',       role: 'USER',        securityLevel: 4, organizationId: null },
  { username: 'partner1', password: 'partner123!',  fullName: '협력업체1',    role: 'PARTNER',     securityLevel: 5, organizationId: null },
] as const;

function findDevUser(username: string, password: string) {
  if (process.env.DEV_AUTH_FALLBACK === 'false') return null;
  const u = DEV_USERS.find((x) => x.username === username && x.password === password);
  if (!u) return null;
  return {
    id: `dev-${u.username}`,
    username: u.username,
    name: u.fullName,
    email: undefined,
    role: u.role,
    securityLevel: u.securityLevel,
    organizationId: u.organizationId,
  };
}

const credentialsSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

/**
 * Custom error classes — Auth.js v5 lets us surface stable codes to the client
 * via `signIn` `error` query param. See login-form.tsx for handling.
 */
class InvalidCredentialsError extends CredentialsSignin {
  code = 'invalid_credentials';
}
class AccountLockedError extends CredentialsSignin {
  code = 'account_locked';
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  // JWT strategy — adapter is still used so we can reference users by id.
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        username: { label: '아이디', type: 'text' },
        password: { label: '비밀번호', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          throw new InvalidCredentialsError();
        }
        const { username, password } = parsed.data;

        // DEV/DEMO 폴백: DB 미가용 시 in-memory 테스트 계정으로 인증.
        // DB 연결이 되더라도 dev에서는 동일하게 매칭되는 계정 우선 통과 (편의).
        let user;
        try {
          user = await prisma.user.findUnique({ where: { username } });
        } catch (err) {
          // DB 미가용 — dev 폴백으로 진행
          user = null;
        }
        if (!user) {
          const dev = findDevUser(username, password);
          if (dev) return dev;
          // Constant-time-ish: still hash a dummy to reduce timing oracle.
          await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinva');
          throw new InvalidCredentialsError();
        }

        // Lockout check.
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          throw new AccountLockedError();
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          const nextCount = user.failedLoginCount + 1;
          const shouldLock = nextCount >= LOCKOUT_THRESHOLD;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: nextCount,
              lockedUntil: shouldLock
                ? new Date(Date.now() + LOCKOUT_DURATION_MS)
                : user.lockedUntil,
            },
          });
          if (shouldLock) throw new AccountLockedError();
          throw new InvalidCredentialsError();
        }

        // Success — reset counters, stamp last login.
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
          },
        });

        // Returned object is fed to `jwt` callback as `user`.
        return {
          id: user.id,
          username: user.username,
          name: user.fullName,
          email: user.email ?? undefined,
          role: user.role,
          securityLevel: user.securityLevel,
          organizationId: user.organizationId,
        };
      },
    }),
  ],
});
