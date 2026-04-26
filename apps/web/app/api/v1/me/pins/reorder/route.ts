// PATCH /api/v1/me/pins/reorder
//
// Body: { type: 'folder' | 'object', ids: string[] }
//
// Replaces the sortOrder of every pin of `type` owned by the current user
// according to the position in `ids` (0-based). Pin ids not owned by the user
// are silently ignored — same authorization gate as the single-row DELETE.
//
// All-or-nothing: the whole reorder runs in one transaction. Partial reorders
// would leave a confusing half-sorted list, so we'd rather reject with a
// validation error than commit a misaligned state.
//
// Owned by BE (R9).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

const bodySchema = z.object({
  type: z.enum(['folder', 'object']),
  ids: z.array(z.string().min(1)).min(1).max(200),
});

export async function PATCH(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const { type, ids } = parsed.data;

  // Drop duplicates while preserving the user's intended order.
  const seen = new Set<string>();
  const uniqueIds = ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Verify every id belongs to the current user — otherwise refuse the whole
  // batch (a single bad id likely means the FE sent stale state).
  if (type === 'folder') {
    const owned = await prisma.userFolderPin.findMany({
      where: { userId: user.id, id: { in: uniqueIds } },
      select: { id: true },
    });
    if (owned.length !== uniqueIds.length) {
      return error(
        ErrorCode.E_VALIDATION,
        '본인 소유가 아닌 핀이 포함되어 있습니다.',
      );
    }
    await prisma.$transaction(
      uniqueIds.map((id, idx) =>
        prisma.userFolderPin.update({
          where: { id },
          data: { sortOrder: idx },
        }),
      ),
    );
  } else {
    const owned = await prisma.userObjectPin.findMany({
      where: { userId: user.id, id: { in: uniqueIds } },
      select: { id: true },
    });
    if (owned.length !== uniqueIds.length) {
      return error(
        ErrorCode.E_VALIDATION,
        '본인 소유가 아닌 핀이 포함되어 있습니다.',
      );
    }
    await prisma.$transaction(
      uniqueIds.map((id, idx) =>
        prisma.userObjectPin.update({
          where: { id },
          data: { sortOrder: idx },
        }),
      ),
    );
  }

  return ok({ type, count: uniqueIds.length });
}
