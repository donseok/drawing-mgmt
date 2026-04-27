// POST /api/v1/me/mfa/confirm — R39 / A-3.
//
// Second step of MFA enrollment. The caller has scanned the QR (or pasted
// the secret) into their authenticator app and posts the first 6-digit
// code to prove possession.
//
// On success:
//   - flip `totpEnabledAt = now()` so the login flow gates this user behind
//     a 2nd-factor step from now on,
//   - generate 10 recovery codes,
//   - bcrypt-hash + persist the recovery codes,
//   - return the *plaintext* codes ONCE (the caller is expected to write
//     them down or store them in a password manager — the server never
//     surfaces them again).
//
// On failure (no in-progress enrollment, code mismatch):
//   - return E_VALIDATION with a stable details code so the FE can
//     re-render the QR step.
//
// Idempotency: re-confirming when `totpEnabledAt` is already set is a no-op
// from the user's perspective except they get a fresh batch of recovery
// codes (the previous batch is invalidated, mirroring "regenerate recovery
// codes" UX).

import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyTotp,
} from '@/lib/totp';
import { extractRequestMeta, logActivity } from '@/lib/audit';

const bodySchema = z.object({
  code: z
    .string()
    .min(6)
    .max(8)
    .regex(/^[\s0-9-]+$/, '숫자 6자리를 입력해 주세요.'),
});

export const POST = withApi({ rateLimit: 'api' }, async (req: Request) => {
  let session;
  try {
    session = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

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

  // Re-fetch the row — we need `totpSecret` (stripped from session helpers).
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, totpSecret: true },
  });
  if (!user || !user.totpSecret) {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      'MFA 등록이 진행 중이지 않습니다. 다시 시도해 주세요.',
      409,
      { reason: 'MFA_NOT_ENROLLED' },
    );
  }

  const codeOk = verifyTotp(user.totpSecret, parsed.data.code);
  if (!codeOk) {
    return error(
      ErrorCode.E_VALIDATION,
      '인증 코드가 올바르지 않습니다.',
      400,
      { field: 'code', code: 'INVALID_TOTP' },
    );
  }

  // Generate + hash recovery codes. Plaintext is returned once; only the
  // hashes hit the DB.
  const recoveryCodes = generateRecoveryCodes();
  const recoveryHashes = await Promise.all(
    recoveryCodes.map((c) => hashRecoveryCode(c)),
  );

  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpEnabledAt: new Date(),
      recoveryCodesHash: recoveryHashes,
    },
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: session.id,
    action: 'MFA_ENROLL',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return ok({ recoveryCodes });
});
