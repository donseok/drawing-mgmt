// PATCH /api/v1/me/preferences — R35 / N-1, extended in R38 / N-2.
//
// User-facing toggle for notification channel preferences.
//
// R35 (N-1): `notifyByEmail`.
// R38 (N-2): `notifyBySms`, `notifyByKakao`, `phoneNumber`.
//
// The schema is open-ended so future channels (push, etc.) drop in as
// additional optional fields.
//
// Why a separate route from PATCH /api/v1/me:
//   - /me carries identity-shaped fields (fullName, email) that admin
//     workflows should NOT cross with notification toggles. Mixing them
//     would force any future audit trail to disambiguate "did the user
//     change their email or their email-channel preference?".
//   - The preferences route is intentionally permissive: any authenticated
//     user can edit *their own* preferences regardless of role. /me's
//     existing PATCH stays focused on profile fields.
//
// Authn: any logged-in user (via `requireUser`).
// Authz: the route only ever updates the caller's own row.
// CSRF + rate-limit: applied via `withApi` wrapper (R28 SEC-1/SEC-3).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';

/**
 * Phone number regex — intentionally lax. Accepts:
 *   - leading `+` (E.164)
 *   - digits and hyphens (KR display style: `+82-10-1234-5678`)
 *   - 8 to 20 chars (covers KR / international ranges)
 *
 * Strict E.164 validation lives in the SMS adapter (lib/sms.ts
 * `normalizePhone`); the API edge only blocks obviously-bogus shapes.
 */
const PHONE_REGEX = /^\+?[0-9-]{8,20}$/;

const patchSchema = z
  .object({
    notifyByEmail: z.boolean().optional(),
    // R38 — N-2 channels.
    notifyBySms: z.boolean().optional(),
    notifyByKakao: z.boolean().optional(),
    /**
     * Phone number. `null` (or empty string) explicitly clears the column.
     * Otherwise must match the lax format regex above.
     *
     * Strict parse so the FE gets a useful error toast — the API surface
     * is ASCII-only here; the SMS driver normalizes hyphens at send time.
     */
    phoneNumber: z
      .union([
        z.string().regex(PHONE_REGEX, '전화번호 형식이 올바르지 않습니다.'),
        z.literal(''),
        z.null(),
      ])
      .optional(),
  })
  .refine(
    (data) =>
      data.notifyByEmail !== undefined ||
      data.notifyBySms !== undefined ||
      data.notifyByKakao !== undefined ||
      data.phoneNumber !== undefined,
    { message: '수정할 환경설정 항목이 하나 이상 필요합니다.' },
  );

export const PATCH = withApi({ rateLimit: 'api' }, async (req: Request) => {
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      '입력값이 유효하지 않습니다.',
      400,
      parsed.error.flatten(),
    );
  }

  const { notifyByEmail, notifyBySms, notifyByKakao, phoneNumber } =
    parsed.data;

  // Build the update payload only with the fields the client actually sent
  // — preserves "PATCH semantics" (omitted fields stay untouched) and avoids
  // surprising defaults wiping out existing preferences.
  const data: {
    notifyByEmail?: boolean;
    notifyBySms?: boolean;
    notifyByKakao?: boolean;
    phoneNumber?: string | null;
  } = {};
  if (notifyByEmail !== undefined) data.notifyByEmail = notifyByEmail;
  if (notifyBySms !== undefined) data.notifyBySms = notifyBySms;
  if (notifyByKakao !== undefined) data.notifyByKakao = notifyByKakao;
  if (phoneNumber !== undefined) {
    // Empty string treated as "clear" — keeps the FE simple (one input field
    // covers both set/clear without a separate DELETE button).
    data.phoneNumber = phoneNumber === '' ? null : phoneNumber;
  }

  const updated = await prisma.user.update({
    where: { id: session.id },
    data,
    select: {
      id: true,
      notifyByEmail: true,
      notifyBySms: true,
      notifyByKakao: true,
      phoneNumber: true,
    },
  });

  return ok({
    id: updated.id,
    notifyByEmail: updated.notifyByEmail,
    notifyBySms: updated.notifyBySms,
    notifyByKakao: updated.notifyByKakao,
    phoneNumber: updated.phoneNumber,
  });
});
