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
//   - R33 / A-1 — optional Keycloak OIDC provider, gated by KEYCLOAK_ENABLED=1.
//     On first sign-in we provision a User row (signIn callback) and on
//     subsequent logins we just bump lastLoginAt. Credentials provider stays
//     wired so dev/fallback access still works without an IdP.
//   - R37 / A-2 — optional SAML 2.0 SSO. Auth.js v5 has no native SAML
//     provider; instead the ACS endpoint at /api/v1/auth/saml/acs validates
//     the IdP response, provisions the User, and mints a 1-minute HMAC
//     bridge token. The Credentials provider's `samlBridge` mode below
//     verifies the token and resolves the User row, so the JWT session
//     contract stays identical to the credentials and Keycloak paths.
//
// See TRD §5.1.

import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Keycloak from 'next-auth/providers/keycloak';
import type { Provider } from 'next-auth/providers';
import { PrismaAdapter } from '@auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { authConfig } from '@/auth.config';
import { verifySamlBridgeToken } from '@/lib/saml';
import { mintMfaBridgeToken, verifyMfaBridgeToken } from '@/lib/mfa-bridge';

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
class InvalidSamlBridgeError extends CredentialsSignin {
  code = 'saml_bridge_invalid';
}

/**
 * R40 / R39 finish — surfaced when the credentials passed validation but the
 * account has MFA on (`totpEnabledAt` set). The `code` field carries the
 * stable client-side token the FE uses to decide "render the 2nd-factor
 * step", and the `cause.mfaToken` payload carries the bridge token. We
 * piggyback on next-auth's CredentialsSignin → URL `error` parameter
 * propagation; the FE login form intercepts this code and redirects to
 * `/login/mfa?token=...` (see auth.ts integration notes below).
 *
 * NOTE: next-auth v5 only exposes `error.code` to the client through the
 * URL query string, not the message body. To pass the bridge token we have
 * to encode it INTO the `code` itself. We pick a delimiter that cannot
 * appear in the base64url body (`:`) and reassemble on the FE.
 */
class MfaRequiredError extends CredentialsSignin {
  code = 'mfa_required';
  constructor(public readonly mfaToken: string) {
    super('mfa_required');
    // Pack the bridge token into the `code` so the FE redirect picks it up.
    // Format: `mfa_required:<token>`. The colon is safe — base64url tokens
    // never contain it.
    this.code = `mfa_required:${mfaToken}`;
  }
}

const isKeycloakEnabled = process.env.KEYCLOAK_ENABLED === '1';

/**
 * R37 / A-2 — verify a SAML bridge token, resolve the User row that the
 * ACS endpoint provisioned, and return the Auth.js User shape. Null/invalid
 * tokens raise InvalidSamlBridgeError (code: saml_bridge_invalid) so the
 * login page can surface a stable error.
 */
async function authorizeSamlBridge(token: string) {
  const userId = verifySamlBridgeToken(token);
  if (!userId) {
    throw new InvalidSamlBridgeError();
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    // The ACS endpoint just provisioned this row, so missing here means the
    // token is forged or the user was deactivated mid-flight. Either way
    // we refuse the session.
    throw new InvalidSamlBridgeError();
  }

  return {
    id: user.id,
    username: user.username,
    name: user.fullName,
    email: user.email ?? undefined,
    role: user.role,
    securityLevel: user.securityLevel,
    organizationId: user.organizationId,
  };
}

/**
 * R40 / R39 finish — verify an MFA bridge token, resolve the User row, and
 * return the Auth.js User shape. Null/invalid tokens raise
 * InvalidSamlBridgeError-equivalent (we reuse the same code namespace via
 * a fresh class so the FE can disambiguate from SAML failures).
 *
 * The /api/v1/auth/mfa/verify endpoint mints the *MFA bridge* token only
 * after the 2nd-factor step succeeds, so by the time we land here the
 * second factor is already proven. We just resolve the user row and return
 * the same shape the password path returns.
 */
async function authorizeMfaBridge(token: string) {
  const userId = verifyMfaBridgeToken(token);
  if (!userId) {
    throw new InvalidCredentialsError();
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    throw new InvalidCredentialsError();
  }
  // Stamp lastLoginAt + reset lockout counters now that the full 2-step
  // flow has completed. (We deliberately did NOT do this on the
  // password-step authorize; that path raised MfaRequiredError instead of
  // returning a user, so it never bumped lastLoginAt.)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });
  return {
    id: user.id,
    username: user.username,
    name: user.fullName,
    email: user.email ?? undefined,
    role: user.role,
    securityLevel: user.securityLevel,
    organizationId: user.organizationId,
  };
}

/**
 * Credentials authorize() with three modes, distinguished by which field is
 * populated:
 *   - `{ username, password }` → standard bcrypt login (default path).
 *     If `totpEnabledAt` is set on the row, throws `MfaRequiredError` with
 *     a 5-min bridge token instead of returning a user — the FE then drives
 *     a /login/mfa POST and re-enters via `mfaBridge`.
 *   - `{ samlBridge: <token> }` → R37 A-2 SAML SSO completion. The ACS
 *     endpoint has already validated the IdP response and provisioned the
 *     User row; the token vouches for that User.id with HMAC + 1-min ttl.
 *   - `{ mfaBridge: <token> }` → R40 MFA 2-step completion. Issued by
 *     /api/v1/auth/mfa/verify after a TOTP/recovery code matches.
 * The two bridge paths skip bcrypt entirely.
 */
const credentialsProvider = Credentials({
  name: 'credentials',
  credentials: {
    username: { label: '아이디', type: 'text' },
    password: { label: '비밀번호', type: 'password' },
    // Hidden field — populated only by the SAML callback page redirect from
    // /api/v1/auth/saml/acs. Type "text" keeps the Auth.js client happy
    // (we don't render this on the credentials login form).
    samlBridge: { label: 'samlBridge', type: 'text' },
    // R40 / R39 finish — MFA 2-step bridge. Populated by /login/mfa after
    // /api/v1/auth/mfa/verify hands back a fresh bridge token.
    mfaBridge: { label: 'mfaBridge', type: 'text' },
  },
  async authorize(raw) {
    // R37 / A-2 — SAML bridge mode. Branches first because the bridge token
    // path skips bcrypt entirely.
    const bridge = (raw as Record<string, unknown> | null)?.samlBridge;
    if (typeof bridge === 'string' && bridge.length > 0) {
      return authorizeSamlBridge(bridge);
    }
    // R40 / R39 finish — MFA bridge mode (post-2nd-factor).
    const mfaBridgeRaw = (raw as Record<string, unknown> | null)?.mfaBridge;
    if (typeof mfaBridgeRaw === 'string' && mfaBridgeRaw.length > 0) {
      return authorizeMfaBridge(mfaBridgeRaw);
    }

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

    // R40 / R39 finish — MFA gate. If the user has confirmed MFA we must NOT
    // issue a session yet. Reset the failed-login counter (the 1st factor
    // succeeded so the lockout pressure should drain) but defer the
    // lastLoginAt bump to the post-MFA authorize path. Then mint a bridge
    // token and throw a CredentialsSignin-derived error — the FE translates
    // the `mfa_required:<token>` error code into a /login/mfa redirect.
    if (user.totpEnabledAt) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      const mfaToken = mintMfaBridgeToken(user.id);
      throw new MfaRequiredError(mfaToken);
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
});

const providers: Provider[] = [credentialsProvider];

if (isKeycloakEnabled) {
  // R33 / A-1 — Keycloak/OIDC SSO. The provider issues an OIDC code-flow
  // round-trip; user provisioning lives in the `signIn` callback below so
  // we never block here on a DB lookup.
  providers.push(
    Keycloak({
      issuer: process.env.KEYCLOAK_ISSUER,
      clientId: process.env.KEYCLOAK_CLIENT_ID,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
    }),
  );
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  // JWT strategy — adapter is still used so we can reference users by id.
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  providers,
  callbacks: {
    ...authConfig.callbacks,
    /**
     * R33 / A-1 — automatic user provisioning for Keycloak/OIDC sign-ins.
     *
     * On every successful Keycloak login we:
     *   1) look up an existing User row by `keycloakSub`,
     *   2) fall back to a username/email lookup (so the first SSO login of an
     *      already-seeded local account links cleanly instead of cloning),
     *   3) INSERT a fresh row when nothing matches.
     *
     * We then mutate the `user` object in place so the `jwt` callback that
     * runs immediately after picks up our DB id + role + securityLevel
     * instead of the OIDC `sub`.
     *
     * Credentials sign-ins skip this entire block.
     */
    async signIn({ user, account, profile }) {
      // Credentials sign-ins skip the entire OIDC provisioning block.
      // (authConfig.callbacks intentionally does not define signIn — the
      // gating decision is `authorized` and is consumed only by middleware.)
      if (account?.provider !== 'keycloak') return true;
      if (!profile || typeof profile.sub !== 'string') {
        // Malformed token — refuse to provision rather than blow up downstream.
        return false;
      }

      const sub = profile.sub;
      // Profile fields with our preferred fallbacks.
      const preferredUsername =
        typeof profile.preferred_username === 'string'
          ? profile.preferred_username
          : sub;
      const fullName =
        typeof profile.name === 'string'
          ? profile.name
          : preferredUsername;
      const email = typeof profile.email === 'string' ? profile.email : null;

      try {
        // 1) Stable lookup: keycloakSub.
        let row = await prisma.user.findUnique({ where: { keycloakSub: sub } });

        // 2) Linking: a username (or email) match means the local account
        //    pre-existed and we should attach the OIDC subject rather than
        //    INSERT a duplicate.
        if (!row) {
          const linkable = await prisma.user.findFirst({
            where: {
              deletedAt: null,
              OR: [
                { username: preferredUsername },
                ...(email ? [{ email }] : []),
              ],
            },
          });
          if (linkable) {
            row = await prisma.user.update({
              where: { id: linkable.id },
              data: {
                keycloakSub: sub,
                lastLoginAt: new Date(),
                failedLoginCount: 0,
                lockedUntil: null,
                ...(email && !linkable.email ? { email } : {}),
              },
            });
          }
        } else {
          // Existing OIDC user — just bump lastLoginAt + reset lockouts.
          row = await prisma.user.update({
            where: { id: row.id },
            data: {
              lastLoginAt: new Date(),
              failedLoginCount: 0,
              lockedUntil: null,
            },
          });
        }

        // 3) Fresh provision.
        if (!row) {
          // OIDC users have no local password — store an unusable bcrypt
          // sentinel so the column stays NOT NULL but credentials login
          // can never succeed for this row.
          row = await prisma.user.create({
            data: {
              username: preferredUsername,
              passwordHash: '$2a$12$keycloakkeycloakkeycloakkeycloakkeycloakkeycloakkeycloak',
              fullName,
              email,
              role: 'USER',
              securityLevel: 5,
              keycloakSub: sub,
              lastLoginAt: new Date(),
            },
          });
        }

        // Hand DB-side identity to the jwt callback.
        // (Auth.js mutates `user` between callbacks; assigning here is the
        // documented integration point for non-Credentials providers.)
        user.id = row.id;
        (user as typeof user & { username: string }).username = row.username;
        (user as typeof user & { role: typeof row.role }).role = row.role;
        (user as typeof user & { securityLevel: number }).securityLevel =
          row.securityLevel;
        (user as typeof user & { organizationId: string | null }).organizationId =
          row.organizationId;

        return true;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[auth] Keycloak provisioning failed', err);
        return false;
      }
    },
  },
});
