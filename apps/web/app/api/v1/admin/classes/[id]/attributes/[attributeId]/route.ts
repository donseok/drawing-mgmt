// /api/v1/admin/classes/:id/attributes/:attributeId
//   PATCH  — partial update. `code` and `dataType` are intentionally
//            immutable to keep ObjectAttributeValue rows consistent.
//   DELETE — drops the attribute. ObjectAttributeValue rows cascade
//            (schema: ObjectAttributeValue.attribute → onDelete: Cascade).
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by BE — R25 카드 B.

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

const patchSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  required: z.boolean().optional(),
  defaultValue: z.string().max(500).nullable().optional(),
  comboItems: z.unknown().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const PATCH = withApi<{ params: { id: string; attributeId: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) {
    return error(ErrorCode.E_FORBIDDEN, '속성 수정 권한이 없습니다.');
  }

  const attribute = await prisma.objectAttribute.findUnique({
    where: { id: params.attributeId },
    select: { id: true, classId: true },
  });
  if (!attribute || attribute.classId !== params.id) {
    return error(ErrorCode.E_NOT_FOUND);
  }

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

  // `comboItems` needs explicit JsonNull handling — `undefined` means "leave
  // alone", `null` means "clear", anything else is JSON.
  const data: Prisma.ObjectAttributeUpdateInput = {
    ...(dto.label !== undefined ? { label: dto.label } : {}),
    ...(dto.required !== undefined ? { required: dto.required } : {}),
    ...(dto.defaultValue !== undefined
      ? { defaultValue: dto.defaultValue }
      : {}),
    ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
  };
  if (dto.comboItems !== undefined) {
    data.comboItems =
      dto.comboItems === null
        ? Prisma.JsonNull
        : (dto.comboItems as Prisma.InputJsonValue);
  }

  const updated = await prisma.objectAttribute.update({
    where: { id: attribute.id },
    data,
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'ATTRIBUTE_UPDATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      classId: params.id,
      attributeId: updated.id,
      fields: Object.keys(dto),
    },
  });

  return ok(updated);
  },
);

export const DELETE = withApi<{ params: { id: string; attributeId: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) {
    return error(ErrorCode.E_FORBIDDEN, '속성 삭제 권한이 없습니다.');
  }

  const attribute = await prisma.objectAttribute.findUnique({
    where: { id: params.attributeId },
    select: { id: true, classId: true, code: true, label: true },
  });
  if (!attribute || attribute.classId !== params.id) {
    return error(ErrorCode.E_NOT_FOUND);
  }

  // ObjectAttributeValue rows cascade via schema (onDelete: Cascade).
  await prisma.objectAttribute.delete({ where: { id: attribute.id } });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'ATTRIBUTE_DELETE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      classId: params.id,
      attributeId: attribute.id,
      code: attribute.code,
      label: attribute.label,
    },
  });

  return ok({ id: attribute.id });
  },
);
