// R37 / A-2 — SAML Assertion Consumer Service.
//
// Receives the IdP's POST containing a base64-encoded `SAMLResponse` + the
// `RelayState` we issued at login. Pipeline:
//
//   1. Validate signature, audience, conditions, NotBefore/NotOnOrAfter
//      (delegated to @node-saml/node-saml).
//   2. Normalize the asserted profile → { sub, email, fullName, username }.
//   3. Provision (or link) a User row keyed on samlSub, mirroring the
//      Keycloak/OIDC linkage in auth.ts signIn callback.
//   4. Mint a 1-minute bridge token referencing the user.id.
//   5. Redirect to /login/saml-callback?token=…&callbackUrl=… so the
//      Credentials provider's "saml-bridge" mode can complete the JWT
//      session round-trip on the same origin.
//
// Why a redirect via the login page (instead of setting the JWT cookie
// directly here):
//   - Auth.js v5 is the source of truth for the session cookie shape, name,
//     and signing keys. Reproducing that in our route is fragile across
//     library upgrades (e.g. cookie name changes, encryption migrations).
//   - The Credentials provider gives us a stable integration point: we tell
//     it "this token vouches for user X", it does its own session.set work
//     and lands the user on `callbackUrl`.
//
// Notes:
//   - SAML POST bypasses our SEC-1 same-origin check on purpose — the IdP
//     posts cross-origin by design. The bridge token + signature on the
//     SAMLResponse stand in for CSRF protection here.
//   - We disable the rate-limit wrapper for the same reason: rejecting an
//     IdP push would lock out the whole org. Brute-forcing the SAML XML
//     signature is not a meaningful attack vector.

import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import {
  isSamlEnabled,
  mintSamlBridgeToken,
  pickSamlIdentity,
  validateAcsResponse,
} from '@/lib/saml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  if (!isSamlEnabled()) {
    return new NextResponse('SAML not configured', { status: 404 });
  }

  // Parse application/x-www-form-urlencoded body (HTTP-POST binding).
  let SAMLResponse: string | undefined;
  let RelayState: string | undefined;
  try {
    const ctype = req.headers.get('content-type') ?? '';
    if (ctype.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData();
      const sr = form.get('SAMLResponse');
      const rs = form.get('RelayState');
      if (typeof sr === 'string') SAMLResponse = sr;
      if (typeof rs === 'string') RelayState = rs;
    } else if (ctype.includes('multipart/form-data')) {
      const form = await req.formData();
      const sr = form.get('SAMLResponse');
      const rs = form.get('RelayState');
      if (typeof sr === 'string') SAMLResponse = sr;
      if (typeof rs === 'string') RelayState = rs;
    } else {
      // Some IdPs send `application/json` from test harnesses.
      const body = (await req.json().catch(() => null)) as
        | { SAMLResponse?: unknown; RelayState?: unknown }
        | null;
      if (body && typeof body.SAMLResponse === 'string') SAMLResponse = body.SAMLResponse;
      if (body && typeof body.RelayState === 'string') RelayState = body.RelayState;
    }
  } catch {
    return badRequest('SAML response parse failed');
  }

  if (!SAMLResponse) {
    return badRequest('Missing SAMLResponse');
  }

  // 1) Validate.
  let identity;
  try {
    const profile = await validateAcsResponse({ SAMLResponse, RelayState });
    identity = pickSamlIdentity(profile);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[saml.acs] validation failed', err);
    // Land the user on /login with a stable error code (no internals leaked).
    return redirectToLogin('saml_invalid_response');
  }

  // 2) Provision / link the User row.
  let userId: string;
  try {
    userId = await provisionSamlUser(identity);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[saml.acs] provisioning failed', err);
    return redirectToLogin('saml_provision_failed');
  }

  // 3) Mint bridge token + bounce to the saml-callback page which calls
  //    `signIn('credentials', { samlBridge: token })`.
  const token = mintSamlBridgeToken(userId);
  const callbackUrl = sanitizeRelay(RelayState ?? null);

  const target = new URL(req.nextUrl.origin);
  target.pathname = '/login/saml-callback';
  target.searchParams.set('token', token);
  target.searchParams.set('callbackUrl', callbackUrl);

  return NextResponse.redirect(target.toString(), { status: 303 });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function badRequest(msg: string): Response {
  return new NextResponse(msg, { status: 400 });
}

function redirectToLogin(errCode: string): Response {
  const url = new URL(
    process.env.NEXTAUTH_URL ?? 'http://localhost:3000',
  );
  url.pathname = '/login';
  url.searchParams.set('error', errCode);
  return NextResponse.redirect(url.toString(), { status: 303 });
}

function sanitizeRelay(input: string | null): string {
  if (!input) return '/';
  if (!input.startsWith('/')) return '/';
  if (input.startsWith('//')) return '/';
  return input.length > 512 ? '/' : input;
}

/**
 * Provision-or-link a User row given a SAML identity. Mirrors the Keycloak
 * provisioning in auth.ts signIn() so the two SSO paths behave identically:
 *
 *   1) Look up by samlSub (stable).
 *   2) Else look up by username/email (link an existing local row).
 *   3) Else INSERT a fresh row with an unusable bcrypt sentinel.
 *
 * Always bumps lastLoginAt + clears lockout state on success.
 */
async function provisionSamlUser(identity: {
  sub: string;
  email: string | null;
  fullName: string;
  username: string;
}): Promise<string> {
  const { sub, email, fullName, username } = identity;

  // 1) Stable lookup.
  let row = await prisma.user.findUnique({ where: { samlSub: sub } });

  // 2) Linking.
  if (!row) {
    const linkable = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ username }, ...(email ? [{ email }] : [])],
      },
    });
    if (linkable) {
      row = await prisma.user.update({
        where: { id: linkable.id },
        data: {
          samlSub: sub,
          lastLoginAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          ...(email && !linkable.email ? { email } : {}),
        },
      });
    }
  } else {
    // Existing SAML user — bump lastLoginAt + reset lockouts.
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
    // Username collision avoidance: if `username` is already taken (by a
    // different user without samlSub), suffix the sub. Rare but possible
    // when two HR sources collide.
    const collision = await prisma.user.findUnique({ where: { username } });
    const finalUsername = collision ? `${username}.${sub.slice(0, 8)}` : username;

    row = await prisma.user.create({
      data: {
        username: finalUsername,
        // Unusable bcrypt sentinel — passwordHash is NOT NULL but credentials
        // login can never succeed for an SSO-only user.
        passwordHash: '$2a$12$samlsamlsamlsamlsamlsamlsamlsamlsamlsamlsamlsamlsamlsa',
        fullName,
        email,
        role: 'USER',
        securityLevel: 5,
        samlSub: sub,
        lastLoginAt: new Date(),
      },
    });
  }

  return row.id;
}
