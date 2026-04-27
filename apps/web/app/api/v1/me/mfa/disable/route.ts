// POST /api/v1/me/mfa/disable — R39 / A-3.
//
// Turn MFA off. To prevent a session-cookie-stealer from disabling MFA on a
// compromised account we re-prove the user is the legitimate holder via:
//   - a current TOTP `code`, OR
//   - the account `password`.
//
// Either suffices — most users will hit "disable MFA" right after losing
// their authenticator and so cannot supply a code; falling back to the
// password keeps the rotation path usable. (After disable, the user can
// always /enroll again with a new authenticator.)
//
// On success:
//   - clear `totpSecret`, `totpEnabledAt`, and `recoveryCodesHash`.
//   - log MFA_DISABLE in ActivityLog.

import type { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { findMatchingRecoveryCode, verifyTotp } from '@/lib/totp';
import { extractRequestMeta, logActivity } from '@/lib/audit';

const bodySchema = z
  .object({
    code: z.string().min(1).max(20).optional(),
    password: z.string().min(1).max(256).optional(),
  })
  .refine((d) => Boolean(d.code) || Boolean(d.password), {
    message: 'TOTP 코드 또는 비밀번호 중 하나가 필요합니다.',
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

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      id: true,
      totpSecret: true,
      totpEnabledAt: true,
      passwordHash: true,
      recoveryCodesHash: true,
    },
  });
  if (!user) {
    return error(ErrorCode.E_NOT_FOUND);
  }

  // Already disabled — return ok so the FE can normalize.
  if (!user.totpEnabledAt && !user.totpSecret) {
    return ok({ disabled: true });
  }

  // Authentication: code OR password. Code path also accepts a recovery code.
  let proofOk = false;
  if (parsed.data.code) {
    if (user.totpSecret && verifyTotp(user.totpSecret, parsed.data.code)) {
      proofOk = true;
    }
    if (!proofOk && user.recoveryCodesHash.length > 0) {
      const idx = await findMatchingRecoveryCode(
        parsed.data.code,
        user.recoveryCodesHash,
      );
      if (idx >= 0) proofOk = true;
    }
  }
  if (!proofOk && parsed.data.password) {
    proofOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
  }

  if (!proofOk) {
    return error(
      ErrorCode.E_VALIDATION,
      'TOTP 코드 또는 비밀번호가 올바르지 않습니다.',
      400,
      { code: 'INVALID_DISABLE_PROOF' },
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecret: null,
      totpEnabledAt: null,
      recoveryCodesHash: [],
    },
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: session.id,
    action: 'MFA_DISABLE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return ok({ disabled: true });
});
