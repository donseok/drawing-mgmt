// /api/v1/admin/groups
//   GET  — every Group with synthesized memberCount.
//   POST — create a new Group. Name must be globally unique (Group.name has a
//          DB-level @unique). ActivityLog GROUP_CREATE.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owner: backend (R30 / U-4).
// Contract reference: `_workspace/api_contract.md` §4.1, §4.2.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) return error(ErrorCode.E_FORBIDDEN);

  const rows = await prisma.group.findMany({
    orderBy: [{ name: 'asc' }],
    include: { _count: { select: { users: true } } },
  });

  const data = rows.map((r) => {
    const { _count, ...rest } = r;
    return { ...rest, memberCount: _count.users };
  });

  return ok(data);
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(50),
  description: z.string().trim().max(200).optional().or(z.literal('').transform(() => undefined)),
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

  // Group.name has a DB-level unique constraint; we surface a friendly 400
  // here before relying on Prisma's P2002.
  const existing = await prisma.group.findUnique({ where: { name: dto.name } });
  if (existing) {
    return error(ErrorCode.E_VALIDATION, '이미 사용 중인 그룹 이름입니다.', 400, {
      field: 'name',
    });
  }

  const created = await prisma.group.create({
    data: {
      name: dto.name,
      description: dto.description ?? null,
    },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
    },
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: actor.id,
    action: 'GROUP_CREATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { groupId: created.id, name: created.name },
  });

  return ok({ ...created, memberCount: 0 }, undefined, { status: 201 });
}

export const POST = withApi({ rateLimit: 'api' }, handlePost);
