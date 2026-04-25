// GET /api/v1/users/search?q=...&limit=10
//
// Public-ish user lookup for picker UIs (e.g. the "결재선" approver picker on
// NewApprovalDialog). Any authenticated user may search — explicitly NOT
// admin-gated (which is what /api/v1/admin/users is for).
//
// Because every authenticated user can hit this endpoint, the response only
// surfaces the minimum needed to render a picker row: id / username / fullName
// + organization label. No email, no role, no securityLevel, no passwordHash.
//
// Search behaviour (per contract):
//   - `q.trim().length < 1` → returns an empty list (no fishing for full roster)
//   - case-insensitive substring match on username OR fullName
//   - filter to active users (`employmentType !== RETIRED`); the schema has no
//     `deletedAt` / `active` columns, so RETIRED is the closest equivalent.
//   - sort by fullName asc, username asc (nulls last is enforced via Prisma)
//   - limit defaults to 10, max 30
//
// Owned by BE (R3c-1).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, EmploymentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

const querySchema = z.object({
  q: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(30, Math.max(1, parseInt(v, 10) || 10)) : 10)),
});

export async function GET(req: Request): Promise<NextResponse> {
  // Auth gate only — no role check. Display-only fields below.
  try {
    await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { limit } = parsed.data;
  const term = (parsed.data.q ?? '').trim();

  // Empty query returns no rows — the picker shouldn't dump the whole roster
  // when the input box is blank.
  if (term.length < 1) {
    return ok({ items: [] as Array<unknown> });
  }

  const where: Prisma.UserWhereInput = {
    AND: [
      { employmentType: { not: EmploymentType.RETIRED } },
      {
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { fullName: { contains: term, mode: 'insensitive' } },
        ],
      },
    ],
  };

  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ fullName: 'asc' }, { username: 'asc' }],
    take: limit,
    select: {
      id: true,
      username: true,
      fullName: true,
      organization: { select: { id: true, name: true } },
    },
  });

  return ok({ items: rows });
}
