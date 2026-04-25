// GET /api/v1/admin/classes
//
// ObjectClass list with attribute summaries (BUG-015 / FE-2).
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

  const rows = await prisma.objectClass.findMany({
    orderBy: [{ code: 'asc' }],
    include: {
      attributes: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          code: true,
          label: true,
          dataType: true,
          required: true,
          sortOrder: true,
        },
      },
      _count: { select: { objects: true } },
    },
  });

  const data = rows.map((r) => {
    const { _count, ...rest } = r;
    return { ...rest, objectCount: _count.objects };
  });

  return ok(data);
}
