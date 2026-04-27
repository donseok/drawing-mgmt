// POST /api/v1/admin/organizations/reorder
//
// Bulk-update sortOrder for a set of sibling organizations sharing the same
// parentId. Body: `{ parentId: string|null, ids: string[] }` — the ids array
// is the desired display order; we assign sortOrder = 0..N-1.
//
// All ids must currently sit under the supplied parentId; otherwise we'd let
// the caller silently re-parent rows. The whole batch runs in a transaction
// so the new ordering is atomic.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owner: backend (R30 / U-3).
// Contract reference: `_workspace/api_contract.md` §3.5.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

const bodySchema = z.object({
  parentId: z.string().min(1).nullable(),
  ids: z.array(z.string().min(1)).min(1).max(500),
});

async function handlePost(req: Request): Promise<NextResponse> {
  let actor;
  try {
    actor = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(actor.role)) return error(ErrorCode.E_FORBIDDEN);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { parentId, ids } = parsed.data;

  // Reject duplicate ids — a duplicate would silently overwrite an earlier
  // assignment and leave gaps elsewhere.
  if (new Set(ids).size !== ids.length) {
    return error(ErrorCode.E_VALIDATION, 'ids에 중복이 있습니다.');
  }

  // Verify every id sits under the claimed parentId. If a row went missing
  // or the FE drag picked up an outsider we want to fail before we touch DB.
  const found = await prisma.organization.findMany({
    where: { id: { in: ids } },
    select: { id: true, parentId: true },
  });
  if (found.length !== ids.length) {
    return error(ErrorCode.E_VALIDATION, '존재하지 않는 조직 id가 포함되어 있습니다.');
  }
  const wrongParent = found.find((o) => (o.parentId ?? null) !== parentId);
  if (wrongParent) {
    return error(
      ErrorCode.E_VALIDATION,
      '동일한 상위 조직 아래 형제만 정렬할 수 있습니다.',
      400,
      { offendingId: wrongParent.id },
    );
  }

  // Atomic batch — single transaction so the new order is observed all at
  // once. We don't bother with logActivity for reorder; it's pure UX state
  // and would dwarf the audit log on every drag.
  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.organization.update({
        where: { id },
        data: { sortOrder: index },
      }),
    ),
  );

  return ok({ count: ids.length });
}

export const POST = withApi({ rateLimit: 'api' }, handlePost);
