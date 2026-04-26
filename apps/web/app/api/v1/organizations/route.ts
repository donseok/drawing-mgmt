// GET /api/v1/organizations?partnersOnly=true
//
// Authenticated-only org list — used by the transmittal (R18) target picker
// so any user can select recipient companies. Distinct from
// `/api/v1/admin/organizations`, which is admin-only and exposes user counts.
//
// Response: minimal `{ id, name, parentId }[]`. No userCount, no internal
// metadata — leaks nothing useful to a partner account.
//
// Owned by BE (R18).

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const url = new URL(req.url);
  // Convention: orgs whose name contains "협력" / "외주" / "Partner" treated as
  // partner orgs. This is a heuristic until a dedicated `kind` column ships;
  // it covers the seeded `org-partner` row and any sibling like 협력업체A/B.
  const partnersOnly = url.searchParams.get('partnersOnly') === 'true';

  const rows = await prisma.organization.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, parentId: true },
  });

  const data = partnersOnly
    ? rows.filter((r) => /협력|외주|partner/i.test(r.name))
    : rows;

  return ok(data);
}
