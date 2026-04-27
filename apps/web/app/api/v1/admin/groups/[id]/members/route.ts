// /api/v1/admin/groups/:id/members
//   GET — list every active member (User.deletedAt IS NULL) of the group.
//          Soft-deleted users are excluded so the admin matrix never shows
//          ghost rows (R4a learning).
//   PUT — full-replace the group's membership. Body `{ userIds: string[] }`
//          (max 1000). All ids must reference active users.
//          Runs in a single transaction: deleteMany + createMany.
//          ActivityLog GROUP_MEMBER_UPDATE captures `{ before, after }` ids.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owner: backend (R30 / U-4).
// Contract reference: `_workspace/api_contract.md` §4.5, §4.6.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';

const MAX_MEMBERS = 1000;

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) return error(ErrorCode.E_FORBIDDEN);

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!group) return error(ErrorCode.E_NOT_FOUND);

  // Two-step pull: relation → user select. Prisma can't filter the relation
  // by the linked User.deletedAt without `where: { user: { deletedAt: null }}`,
  // so we use `userGroup.findMany` with that filter applied to the join.
  const rows = await prisma.userGroup.findMany({
    where: {
      groupId: group.id,
      user: { deletedAt: null },
    },
    select: {
      user: {
        select: {
          id: true,
          username: true,
          fullName: true,
          email: true,
          organizationId: true,
        },
      },
    },
    orderBy: { user: { fullName: 'asc' } },
  });

  const data = rows.map((r) => r.user);
  return ok(data);
}

const putSchema = z.object({
  userIds: z.array(z.string().min(1)).max(MAX_MEMBERS),
});

async function handlePut(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let actor;
  try {
    actor = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(actor.role)) return error(ErrorCode.E_FORBIDDEN);

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!group) return error(ErrorCode.E_NOT_FOUND);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }

  // Dedupe — payload duplicates would otherwise blow up the createMany unique
  // composite (userId, groupId).
  const desired = Array.from(new Set(parsed.data.userIds));

  // Verify every userId resolves to an active user. We do this in one IN()
  // query rather than N findUniques.
  if (desired.length > 0) {
    const found = await prisma.user.findMany({
      where: { id: { in: desired }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== desired.length) {
      const foundSet = new Set(found.map((u) => u.id));
      const missing = desired.find((id) => !foundSet.has(id));
      return error(
        ErrorCode.E_VALIDATION,
        '존재하지 않거나 비활성 사용자가 포함되어 있습니다.',
        400,
        { missingUserId: missing },
      );
    }
  }

  // Capture the "before" set so the activity log carries a real diff. We
  // intentionally read this *outside* the transaction — the after-snapshot is
  // the desired set, and the audit row is best-effort anyway.
  const beforeRows = await prisma.userGroup.findMany({
    where: { groupId: group.id },
    select: { userId: true },
  });
  const before = beforeRows.map((r) => r.userId).sort();

  await prisma.$transaction([
    prisma.userGroup.deleteMany({ where: { groupId: group.id } }),
    ...(desired.length > 0
      ? [
          prisma.userGroup.createMany({
            data: desired.map((userId) => ({ userId, groupId: group.id })),
          }),
        ]
      : []),
  ]);

  const after = [...desired].sort();
  const meta = extractRequestMeta(req);
  await logActivity({
    userId: actor.id,
    action: 'GROUP_MEMBER_UPDATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      groupId: group.id,
      groupName: group.name,
      before,
      after,
      added: after.filter((id) => !before.includes(id)),
      removed: before.filter((id) => !after.includes(id)),
    },
  });

  return ok({ memberCount: desired.length });
}

export const PUT = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  handlePut,
);
