// /api/v1/admin/groups/:id
//   PATCH  — update name/description. name uniqueness re-checked on rename.
//   DELETE — hard-delete the group. UserGroup rows cascade automatically
//            (Group.users → onDelete: Cascade in schema), so members aren't
//            orphaned; admin must accept that the link is gone.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owner: backend (R30 / U-4).
// Contract reference: `_workspace/api_contract.md` §4.3, §4.4.

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

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    description: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: '변경할 필드가 없습니다.',
  });

async function handlePatch(
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

  const target = await prisma.group.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, description: true },
  });
  if (!target) return error(ErrorCode.E_NOT_FOUND);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const dto = parsed.data;

  if (dto.name !== undefined && dto.name !== target.name) {
    const dup = await prisma.group.findUnique({ where: { name: dto.name } });
    if (dup) {
      return error(ErrorCode.E_VALIDATION, '이미 사용 중인 그룹 이름입니다.', 400, {
        field: 'name',
      });
    }
  }

  const updated = await prisma.group.update({
    where: { id: target.id },
    data: {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
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
    action: 'GROUP_UPDATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      groupId: target.id,
      changes: Object.keys(dto),
      before: { name: target.name, description: target.description },
      after: { name: updated.name, description: updated.description },
    },
  });

  return ok(updated);
}

async function handleDelete(
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

  const target = await prisma.group.findUnique({
    where: { id: params.id },
    include: { _count: { select: { users: true } } },
  });
  if (!target) return error(ErrorCode.E_NOT_FOUND);

  // UserGroup rows cascade thanks to schema.prisma `onDelete: Cascade`.
  await prisma.group.delete({ where: { id: target.id } });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: actor.id,
    action: 'GROUP_DELETE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      groupId: target.id,
      name: target.name,
      removedMembers: target._count.users,
    },
  });

  return ok({ id: target.id });
}

export const PATCH = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  handlePatch,
);

export const DELETE = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  handleDelete,
);
