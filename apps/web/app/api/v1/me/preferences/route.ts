// PATCH /api/v1/me/preferences — R35 / N-1.
//
// User-facing toggle for notification channel preferences. Today the only
// channel is email (`notifyByEmail`); the schema is open-ended so future
// channels (push, SMS, ...) drop in as additional optional fields.
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

const patchSchema = z
  .object({
    notifyByEmail: z.boolean().optional(),
  })
  .refine((data) => data.notifyByEmail !== undefined, {
    message: '수정할 환경설정 항목이 하나 이상 필요합니다.',
  });

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

  const { notifyByEmail } = parsed.data;

  const updated = await prisma.user.update({
    where: { id: session.id },
    data: {
      ...(notifyByEmail !== undefined ? { notifyByEmail } : {}),
    },
    select: {
      id: true,
      notifyByEmail: true,
    },
  });

  return ok({
    id: updated.id,
    notifyByEmail: updated.notifyByEmail,
  });
});
