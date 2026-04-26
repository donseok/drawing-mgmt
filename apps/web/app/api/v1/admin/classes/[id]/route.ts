// /api/v1/admin/classes/:id
//   GET    — single ObjectClass with attributes (sortOrder asc).
//   PATCH  — rename / re-describe. `code` is intentionally immutable to keep
//            autonumber-derived references stable.
//   DELETE — only if no ObjectEntity uses this class. Attributes cascade.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by BE — R25 카드 B.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});

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
  if (!isAdmin(user.role)) {
    return error(ErrorCode.E_FORBIDDEN);
  }

  const klass = await prisma.objectClass.findUnique({
    where: { id: params.id },
    include: {
      attributes: {
        orderBy: { sortOrder: 'asc' },
      },
      _count: { select: { objects: true } },
    },
  });
  if (!klass) return error(ErrorCode.E_NOT_FOUND);

  const { _count, ...rest } = klass;
  return ok({ ...rest, objectCount: _count.objects });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) {
    return error(ErrorCode.E_FORBIDDEN, '자료유형 수정 권한이 없습니다.');
  }

  const existing = await prisma.objectClass.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!existing) return error(ErrorCode.E_NOT_FOUND);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const dto = parsed.data;

  const updated = await prisma.objectClass.update({
    where: { id: existing.id },
    data: {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    },
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'CLASS_UPDATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { classId: updated.id, fields: Object.keys(dto) },
  });

  return ok(updated);
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) {
    return error(ErrorCode.E_FORBIDDEN, '자료유형 삭제 권한이 없습니다.');
  }

  const klass = await prisma.objectClass.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      code: true,
      name: true,
      _count: { select: { objects: true } },
    },
  });
  if (!klass) return error(ErrorCode.E_NOT_FOUND);

  // Refuse if any ObjectEntity references this class — preserves data history
  // and avoids orphaning attribute values. Operator must reassign or delete
  // those objects first.
  if (klass._count.objects > 0) {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      '이 자료유형을 사용 중인 자료가 있어 삭제할 수 없습니다.',
    );
  }

  // Empty class — attribute rows cascade via schema (ObjectClass → attributes
  // are NOT cascade in schema; we delete explicitly first to be safe).
  // Actually the schema sets ObjectAttribute.class with onDelete: Cascade on
  // the *child* side (attribute → class), which means deleting the parent
  // cascades children. So a single delete suffices.
  await prisma.objectClass.delete({ where: { id: klass.id } });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'CLASS_DELETE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { classId: klass.id, code: klass.code, name: klass.name },
  });

  return ok({ id: klass.id });
}
