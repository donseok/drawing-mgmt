// GET /api/v1/admin/organizations
//
// Flat list of organizations (BUG-015 / FE-2). Includes parentId so the FE
// can render a tree, plus userCount for the admin overview table.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by BE-2.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
    return error(ErrorCode.E_FORBIDDEN);
  }

  const rows = await prisma.organization.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { users: true } },
    },
  });

  const data = rows.map((r) => {
    const { _count, ...rest } = r;
    return { ...rest, userCount: _count.users };
  });

  return ok(data);
}
