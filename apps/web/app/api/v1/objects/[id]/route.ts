// /api/v1/objects/:id
//   GET    — full object detail with relations.
//   PATCH  — update name/description/securityLevel/attributes
//            (must be CHECKED_OUT and locked by current user).
//   DELETE — soft-delete (deletedAt now, state=DELETED).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ObjectState } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  toPermissionUser,
  loadFolderPermissions,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  securityLevel: z.number().int().min(1).max(5).optional(),
  attributes: z
    .array(
      z.object({
        attributeId: z.string().min(1),
        value: z.string().max(1000),
      }),
    )
    .optional(),
});

const detailInclude = {
  folder: { select: { id: true, name: true, folderCode: true } },
  class: { select: { id: true, code: true, name: true } },
  owner: {
    select: { id: true, username: true, fullName: true, organizationId: true },
  },
  lockedBy: {
    select: { id: true, username: true, fullName: true },
  },
  attributes: {
    include: {
      attribute: {
        select: {
          id: true,
          code: true,
          label: true,
          dataType: true,
          required: true,
          comboItems: true,
          sortOrder: true,
        },
      },
    },
  },
  links: {
    include: {
      target: {
        select: { id: true, number: true, name: true, state: true },
      },
    },
  },
  linkedFrom: {
    include: {
      source: {
        select: { id: true, number: true, name: true, state: true },
      },
    },
  },
  revisions: {
    orderBy: { rev: 'desc' as const },
    include: {
      versions: {
        orderBy: { ver: 'desc' as const },
        include: { attachments: true },
      },
    },
  },
} as const;

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

  const obj = await prisma.objectEntity.findUnique({
    where: { id: params.id },
    include: detailInclude,
  });
  if (!obj) return error(ErrorCode.E_NOT_FOUND);

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);

  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions([obj.folderId]),
  ]);
  const decision = canAccess(
    pUser,
    {
      id: obj.id,
      folderId: obj.folderId,
      ownerId: obj.ownerId,
      securityLevel: obj.securityLevel,
    },
    perms,
    'VIEW',
  );
  if (!decision.allowed) return error(ErrorCode.E_FORBIDDEN, decision.reason);

  return ok(obj);
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

  const obj = await prisma.objectEntity.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      folderId: true,
      ownerId: true,
      securityLevel: true,
      state: true,
      lockedById: true,
    },
  });
  if (!obj) return error(ErrorCode.E_NOT_FOUND);

  // EDIT permission required.
  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);
  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions([obj.folderId]),
  ]);
  const decision = canAccess(pUser, obj, perms, 'EDIT');
  if (!decision.allowed) return error(ErrorCode.E_FORBIDDEN, decision.reason);

  // State machine: must be CHECKED_OUT and locked by this user.
  if (obj.state !== ObjectState.CHECKED_OUT) {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      '체크아웃 상태에서만 수정할 수 있습니다.',
    );
  }
  if (obj.lockedById !== user.id) {
    return error(ErrorCode.E_LOCKED, '본인이 체크아웃한 자료만 수정할 수 있습니다.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.objectEntity.update({
      where: { id: obj.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.securityLevel !== undefined
          ? { securityLevel: dto.securityLevel }
          : {}),
      },
    });
    if (dto.attributes) {
      // Upsert each attribute value.
      for (const a of dto.attributes) {
        await tx.objectAttributeValue.upsert({
          where: {
            objectId_attributeId: {
              objectId: obj.id,
              attributeId: a.attributeId,
            },
          },
          update: { value: a.value },
          create: {
            objectId: obj.id,
            attributeId: a.attributeId,
            value: a.value,
          },
        });
      }
    }
    return u;
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'OBJECT_UPDATE',
    objectId: obj.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { fields: Object.keys(dto) },
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

  const obj = await prisma.objectEntity.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      folderId: true,
      ownerId: true,
      securityLevel: true,
      state: true,
      deletedAt: true,
    },
  });
  if (!obj) return error(ErrorCode.E_NOT_FOUND);
  if (obj.deletedAt)
    return error(ErrorCode.E_STATE_CONFLICT, '이미 폐기된 자료입니다.');

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);
  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions([obj.folderId]),
  ]);
  const decision = canAccess(pUser, obj, perms, 'DELETE');
  if (!decision.allowed) return error(ErrorCode.E_FORBIDDEN, decision.reason);

  const deleted = await prisma.objectEntity.update({
    where: { id: obj.id },
    data: {
      state: ObjectState.DELETED,
      deletedAt: new Date(),
      lockedById: null,
    },
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'OBJECT_DELETE',
    objectId: obj.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return ok(deleted);
}
