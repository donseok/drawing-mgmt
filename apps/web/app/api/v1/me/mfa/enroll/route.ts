// POST /api/v1/me/mfa/enroll — R39 / A-3.
//
// Provision a fresh TOTP secret for the caller and return:
//   - the base32 secret (so the user can paste manually if QR scanning fails),
//   - the otpauth:// URL,
//   - a base64 PNG dataURL for the QR scanner.
//
// The secret is persisted with `totpEnabledAt = null` so an interrupted
// enrollment (page closed before /confirm) leaves the account in a known
// "enrolled-but-unconfirmed" state. Calling /enroll again rotates the
// secret and supersedes any prior in-flight enrollment.
//
// MFA is NOT considered active until /confirm succeeds (it flips
// `totpEnabledAt`). Login flow keys off `totpEnabledAt`, not `totpSecret`.

import type { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import {
  buildOtpauthUrl,
  generateQrDataUrl,
  generateSecret,
} from '@/lib/totp';

export const POST = withApi({ rateLimit: 'api' }, async () => {
  let session;
  try {
    session = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  // Generate a fresh secret. We always rotate on /enroll — previously-issued
  // QR codes from an aborted enrollment become stale. (If the caller has
  // already confirmed, this resets MFA: their old TOTP stops working until
  // they re-confirm. That's an acceptable trade — explicit "rotate" UX
  // can be added later as a separate endpoint.)
  const secret = generateSecret();
  const otpauthUrl = buildOtpauthUrl({
    secret,
    label: session.username,
    issuer: 'drawing-mgmt',
  });

  let qrcode: string;
  try {
    qrcode = await generateQrDataUrl(otpauthUrl);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mfa.enroll] qrcode render failed', err);
    return error(ErrorCode.E_INTERNAL, 'QR 코드 생성에 실패했습니다.');
  }

  await prisma.user.update({
    where: { id: session.id },
    // Reset enroll state: stash secret, clear confirmation + recovery codes
    // (they'd be valid for the *previous* secret otherwise).
    data: {
      totpSecret: secret,
      totpEnabledAt: null,
      recoveryCodesHash: [],
    },
  });

  return ok({ secret, otpauthUrl, qrcode });
});
