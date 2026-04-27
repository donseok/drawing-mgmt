// /api/v1/admin/organizations/:id
//   PATCH  — partial update of name / parentId / sortOrder. parentId changes
//            are guarded against cycles: the new parent must not be the org
//            itself nor any of its descendants (otherwise we'd create an
//            infinite loop in the tree).
//   DELETE — refuses (E_STATE_CONFLICT) when the org has children or active
//            users. Admin must reassign first.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owner: backend (R30 / U-3).
// Contract reference: `_workspace/api_contract.md` §3.3, §3.4.

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
    parentId: z.string().min(1).nullable().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: '변경할 필드가 없습니다.',
  });

/**
 * Returns the set of org ids that are `id` or any of its descendants.
 * We pull every org once and walk children in JS — far simpler than a CTE
 * and the Organization table is small (typically dozens of rows, never
 * 100k+). Same approach the FE uses to render the tree.
 */
async function loadDescendantIds(rootId: string): Promise<Set<string>> {
  const all = await prisma.organization.findMany({
    select: { id: true, parentId: true },
  });
  const childrenByParent = new Map<string, string[]>();
  for (const o of all) {
    if (!o.parentId) continue;
    const arr = childrenByParent.get(o.parentId);
    if (arr) arr.push(o.id);
    else childrenByParent.set(o.parentId, [o.id]);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const kids = childrenByParent.get(cur);
    if (!kids) continue;
    for (const k of kids) {
      if (!out.has(k)) {
        out.add(k);
        stack.push(k);
      }
    }
  }
  return out;
}

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

  const target = await prisma.organization.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, parentId: true, sortOrder: true },
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

  // Resolve the *new* parentId (after the patch is applied). `null` means
  // explicitly setting it to root; `undefined` means "don't change".
  const nextParentId =
    dto.parentId === undefined ? target.parentId : dto.parentId ?? null;
  const nextName = dto.name ?? target.name;

  // Cycle guard — only relevant if parentId is actually changing.
  if (dto.parentId !== undefined && nextParentId !== target.parentId) {
    if (nextParentId === target.id) {
      return error(
        ErrorCode.E_VALIDATION,
        '자기 자신을 상위 조직으로 지정할 수 없습니다.',
        400,
        { field: 'parentId' },
      );
    }
    if (nextParentId) {
      // Make sure the new parent exists.
      const parent = await prisma.organization.findUnique({
        where: { id: nextParentId },
        select: { id: true },
      });
      if (!parent) {
        return error(
          ErrorCode.E_VALIDATION,
          '존재하지 않는 상위 조직입니다.',
          400,
          { field: 'parentId' },
        );
      }
      const descendants = await loadDescendantIds(target.id);
      if (descendants.has(nextParentId)) {
        return error(
          ErrorCode.E_VALIDATION,
          '하위 조직을 상위 조직으로 지정할 수 없습니다.',
          400,
          { field: 'parentId' },
        );
      }
    }
  }

  // Sibling-level name uniqueness — re-check whenever name OR parentId moves.
  if (
    (dto.name !== undefined && dto.name !== target.name) ||
    (dto.parentId !== undefined && nextParentId !== target.parentId)
  ) {
    const dup = await prisma.organization.findFirst({
      where: {
        parentId: nextParentId,
        name: nextName,
        NOT: { id: target.id },
      },
      select: { id: true },
    });
    if (dup) {
      return error(
        ErrorCode.E_VALIDATION,
        '같은 상위 조직 내에 동일한 이름이 있습니다.',
        400,
        { field: 'name' },
      );
    }
  }

  const updated = await prisma.organization.update({
    where: { id: target.id },
    data: {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.parentId !== undefined ? { parentId: dto.parentId ?? null } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
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
    action: 'ORG_UPDATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      orgId: target.id,
      changes: Object.keys(dto),
      before: {
        name: target.name,
        parentId: target.parentId,
        sortOrder: target.sortOrder,
      },
      after: {
        name: updated.name,
        parentId: updated.parentId,
        sortOrder: updated.sortOrder,
      },
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

  const target = await prisma.organization.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, parentId: true },
  });
  if (!target) return error(ErrorCode.E_NOT_FOUND);

  // Refuse if there are children or active members. Admin must reassign first.
  const [childCount, userCount] = await Promise.all([
    prisma.organization.count({ where: { parentId: target.id } }),
    prisma.user.count({
      where: { organizationId: target.id, deletedAt: null },
    }),
  ]);

  if (childCount > 0) {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      '하위 조직이 존재합니다. 먼저 이동/삭제하세요.',
      undefined,
      { reason: 'HAS_CHILDREN', childCount },
    );
  }
  if (userCount > 0) {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      '소속 사용자가 존재합니다. 먼저 이동/삭제하세요.',
      undefined,
      { reason: 'HAS_USERS', userCount },
    );
  }

  await prisma.organization.delete({ where: { id: target.id } });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: actor.id,
    action: 'ORG_DELETE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { orgId: target.id, name: target.name, parentId: target.parentId },
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
