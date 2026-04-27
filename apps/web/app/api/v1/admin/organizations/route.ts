// /api/v1/admin/organizations
//   GET  — flat list of all organizations with synthesized userCount + childCount
//          counts. The FE composes the tree from parentId.
//   POST — create a new organization. Name must be unique among siblings under
//          the same parentId. ActivityLog ORG_CREATE.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owner: backend (R30 / U-3).
// Contract reference: `_workspace/api_contract.md` §3.1, §3.2.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

// ── GET ───────────────────────────────────────────────────────────────────
//
// We want every Organization plus two synthesized counters:
//   - userCount  — how many active users (deletedAt IS NULL) belong to this org
//   - childCount — how many child orgs sit directly below it
// Both can be derived from a single groupBy() per dimension; a relation-include
// `_count` would also work but we'd lose the deletedAt filter on users.

export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) return error(ErrorCode.E_FORBIDDEN);

  const [orgs, userGroups, childGroups] = await Promise.all([
    prisma.organization.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        parentId: true,
        sortOrder: true,
        createdAt: true,
      },
    }),
    prisma.user.groupBy({
      by: ['organizationId'],
      where: { deletedAt: null, organizationId: { not: null } },
      _count: { _all: true },
    }),
    prisma.organization.groupBy({
      by: ['parentId'],
      where: { parentId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const userCountMap = new Map<string, number>();
  for (const r of userGroups) {
    if (r.organizationId) userCountMap.set(r.organizationId, r._count._all);
  }
  const childCountMap = new Map<string, number>();
  for (const r of childGroups) {
    if (r.parentId) childCountMap.set(r.parentId, r._count._all);
  }

  const data = orgs.map((o) => ({
    ...o,
    userCount: userCountMap.get(o.id) ?? 0,
    childCount: childCountMap.get(o.id) ?? 0,
  }));

  return ok(data);
}

// ── POST ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(1).max(50),
  parentId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
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
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const dto = parsed.data;
  const parentId = dto.parentId ?? null;

  // Verify parent exists if provided.
  if (parentId) {
    const parent = await prisma.organization.findUnique({
      where: { id: parentId },
      select: { id: true },
    });
    if (!parent) {
      return error(ErrorCode.E_VALIDATION, '존재하지 않는 상위 조직입니다.', 400, {
        field: 'parentId',
      });
    }
  }

  // Sibling-level name uniqueness — prisma schema doesn't enforce this with a
  // unique index because parentId is nullable, so we check explicitly.
  const dup = await prisma.organization.findFirst({
    where: { parentId, name: dto.name },
    select: { id: true },
  });
  if (dup) {
    return error(ErrorCode.E_VALIDATION, '같은 상위 조직 내에 동일한 이름이 있습니다.', 400, {
      field: 'name',
    });
  }

  // sortOrder default — append to end of siblings.
  const sortOrder =
    dto.sortOrder ??
    ((
      await prisma.organization.aggregate({
        where: { parentId },
        _max: { sortOrder: true },
      })
    )._max.sortOrder ?? -1) + 1;

  const created = await prisma.organization.create({
    data: {
      name: dto.name,
      parentId,
      sortOrder,
    },
    select: {
      id: true,
      name: true,
      parentId: true,
      sortOrder: true,
      createdAt: true,
    },
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: actor.id,
    action: 'ORG_CREATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { orgId: created.id, name: created.name, parentId: created.parentId },
  });

  return ok(
    {
      ...created,
      userCount: 0,
      childCount: 0,
    },
    undefined,
    { status: 201 },
  );
}

export const POST = withApi({ rateLimit: 'api' }, handlePost);

// Silence unused-import warning if Prisma's namespace utilities aren't
// referenced directly above.
void Prisma;
