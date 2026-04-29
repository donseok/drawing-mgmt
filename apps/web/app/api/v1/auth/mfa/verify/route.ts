// POST /api/v1/auth/mfa/verify — R40 / R39 finish.
//
// 2nd-factor verification step in the MFA login flow. After Credentials
// authorize() succeeds with a bcrypt match, auth.ts notices `totpEnabledAt`
// is set and throws MfaRequiredError with a 5-min bridge token instead of
// issuing a session. The FE catches the `mfa_required:<token>` error code,
// redirects to /login/mfa, and posts the user-supplied 6-digit code (or
// recovery code) here.
//
// We:
//   1. Verify the bridge token with verifyMfaToken — short-circuits on
//      tampering, expiry, or replay.
//   2. Look up the user row and check for a TOTP/recovery match.
//   3. On success, mint a *fresh* bridge token (single-use semantics —
//      the original is now consumed in spirit; we don't hold a denylist
//      but the FE only ever uses each one once) and hand it back. The
//      FE then calls `signIn('credentials', { mfaBridge: token })` to
//      complete the session.
//   4. On recovery-code match, splice the consumed hash out of
//      `recoveryCodesHash` so it's truly single-use.
//   5. Log MFA_VERIFY_SUCCESS or MFA_VERIFY_FAIL in ActivityLog.
//
// Auth note: this endpoint is intentionally PRE-session — it must work
// for an unauthenticated browser since the user is mid-login. We protect
// it via the bridge token (signed with AUTH_SECRET, 5-min ttl) instead of
// a session cookie. CSRF is NOT enforced because the same-origin policy
// won't help us across the SAML/MFA bridge round-trip; the bridge token
// itself is the proof.

import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { mintMfaToken } from '@/lib/mfa-bridge';
import { decodeMfaBridgeToken, findMatchingRecoveryCode, verifyTotp } from '@/lib/totp';
import { consumeBridgeJti } from '@/lib/bridge-token-store';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';
import { rateLimit, RateLimitConfig } from '@/lib/rate-limit';

const bodySchema = z
  .object({
    mfaToken: z.string().min(1).max(2048),
    code: z.string().min(1).max(20).optional(),
    recoveryCode: z.string().min(1).max(40).optional(),
  })
  .refine((d) => Boolean(d.code) || Boolean(d.recoveryCode), {
    message: 'TOTP 코드 또는 복구 코드가 필요합니다.',
  });

async function verifyHandler(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '잘못된 JSON 형식입니다.');
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      '입력값이 유효하지 않습니다.',
      400,
      parsed.error.flatten(),
    );
  }
  const { mfaToken, code, recoveryCode } = parsed.data;

  // 1) Bridge token verify (HMAC + ttl). Single-use consume on the *outbound*
  //    leg only (after the second factor lands) so legitimate retries on the
  //    wrong code aren't punished by the jti store.
  const inboundBridge = decodeMfaBridgeToken(mfaToken);
  if (!inboundBridge) {
    return error(
      ErrorCode.E_AUTH,
      'MFA 토큰이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.',
      401,
      { code: 'MFA_BRIDGE_INVALID' },
    );
  }
  const userId = inboundBridge.uid;

  // Per-user TOTP-attempt budget (LOGIN policy: 5/min). Without this the bridge
  // token's 5-min TTL would otherwise admit unlimited brute force of the
  // 6-digit TOTP keyspace + 10 bcrypt comparisons per recovery-code attempt.
  const rl = await rateLimit({
    key: `mfa-verify:user:${userId}`,
    ...RateLimitConfig.LOGIN,
  });
  if (!rl.allowed) {
    const resp = error(
      ErrorCode.E_RATE_LIMIT,
      '너무 많은 인증 시도가 감지되었습니다. 잠시 후 다시 시도해 주세요.',
    );
    resp.headers.set('Retry-After', String(rl.retryAfter));
    return resp;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      deletedAt: true,
      totpSecret: true,
      totpEnabledAt: true,
      recoveryCodesHash: true,
    },
  });
  if (!user || user.deletedAt) {
    return error(ErrorCode.E_AUTH, undefined, 401);
  }
  // The user's MFA must still be enabled — if they disabled it mid-flow
  // the original bridge is stale.
  if (!user.totpEnabledAt) {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      '계정의 2단계 인증이 비활성화되었습니다. 다시 로그인해 주세요.',
      409,
      { code: 'MFA_NOT_ENABLED' },
    );
  }

  // 2) Verify the second factor. We accept TOTP first; recovery code is the
  //    fallback the user opts into via the FE toggle.
  const meta = extractRequestMeta(req);
  let verified = false;
  let consumedRecoveryIdx = -1;

  if (code && user.totpSecret && verifyTotp(user.totpSecret, code)) {
    verified = true;
  } else if (recoveryCode && user.recoveryCodesHash.length > 0) {
    consumedRecoveryIdx = await findMatchingRecoveryCode(
      recoveryCode,
      user.recoveryCodesHash,
    );
    if (consumedRecoveryIdx >= 0) verified = true;
  }

  if (!verified) {
    await logActivity({
      userId: user.id,
      action: 'MFA_VERIFY_FAIL',
      objectId: null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return error(
      ErrorCode.E_VALIDATION,
      '인증 코드가 올바르지 않습니다.',
      400,
      { code: 'INVALID_MFA_CODE' },
    );
  }

  // 3) Burn the recovery code (single-use) when that branch was taken.
  if (consumedRecoveryIdx >= 0) {
    const next = user.recoveryCodesHash.filter(
      (_, i) => i !== consumedRecoveryIdx,
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { recoveryCodesHash: next },
    });
  }

  // 4) Verify succeeded — consume the inbound bridge jti so a captured copy
  //    of it (paired with the user's correct code) can't be replayed against
  //    this endpoint to mint additional session bridges.
  if (!(await consumeBridgeJti(inboundBridge.jti, 5 * 60))) {
    return error(
      ErrorCode.E_AUTH,
      'MFA 토큰이 이미 사용되었습니다. 다시 로그인해 주세요.',
      401,
      { code: 'MFA_BRIDGE_INVALID' },
    );
  }

  // 5) Mint a *fresh* bridge token to hand to the credentials provider's
  //    `mfaBridge` mode. We don't reuse the inbound token because by here
  //    its remaining ttl is unknown; minting a new one resets the 5-min
  //    window for the second leg of the round-trip.
  const sessionBridge = mintMfaToken(user.id);

  await logActivity({
    userId: user.id,
    action: 'MFA_VERIFY_SUCCESS',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { used: consumedRecoveryIdx >= 0 ? 'recovery' : 'totp' },
  });

  return ok({ mfaBridgeToken: sessionBridge });
}

// CSRF is intentionally skipped: this endpoint runs pre-session during the
// MFA login bridge round-trip. The bridge token (HMAC + 5-min TTL) is the
// proof, not a session cookie. Rate limit at the IP level (api scope) and
// per-userId (LOGIN policy, applied inside the handler).
export const POST = withApi({ skipCsrf: true, rateLimit: 'api' }, verifyHandler);
