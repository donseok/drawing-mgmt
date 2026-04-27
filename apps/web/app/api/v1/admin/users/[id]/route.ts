// /api/v1/admin/users/:id
//   GET    — single user (no passwordHash) + synthesized lockStatus.
//   PATCH  — partial update. Self-demotion is forbidden. ADMIN cannot mutate
//            a SUPER_ADMIN. Granting SUPER_ADMIN requires the actor to be
//            SUPER_ADMIN.
//   DELETE — soft delete (`deletedAt = now()`, `employmentType = RETIRED`).
//            Self-deletion is forbidden. ADMIN cannot delete a SUPER_ADMIN.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by BE-2 — see `_workspace/api_contract.md` §4.1, §4.2, §4.6.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Role, EmploymentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';

function lockStatusFor(lockedUntil: Date | null): 'LOCKED' | 'NONE' {
  if (!lockedUntil) return 'NONE';
  return lockedUntil.getTime() > Date.now() ? 'LOCKED' : 'NONE';
}

async function loadTarget(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      fullName: true,
      email: true,
      role: true,
      employmentType: true,
      securityLevel: true,
      organizationId: true,
      signatureFile: true,
      lastLoginAt: true,
      lockedUntil: true,
      failedLoginCount: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      organization: { select: { id: true, name: true } },
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let actor;
  try {
    actor = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN') {
    return error(ErrorCode.E_FORBIDDEN);
  }

  const target = await loadTarget(params.id);
  if (!target) return error(ErrorCode.E_NOT_FOUND);

  return ok({
    ...target,
    lockStatus: lockStatusFor(target.lockedUntil),
  });
}

const patchSchema = z
  .object({
    fullName: z.string().min(1).max(64).optional(),
    email: z
      .string()
      .email()
      .max(256)
      .optional()
      .or(z.literal('').transform(() => null)),
    role: z.nativeEnum(Role).optional(),
    employmentType: z.nativeEnum(EmploymentType).optional(),
    securityLevel: z.number().int().min(1).max(5).optional(),
    organizationId: z.string().min(1).nullable().optional(),
    signatureFile: z.string().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '변경할 필드가 없습니다.' });

export async function PATCH(
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
  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN') {
    return error(ErrorCode.E_FORBIDDEN);
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, role: true, deletedAt: true },
  });
  if (!target) return error(ErrorCode.E_NOT_FOUND);
  if (target.deletedAt) return error(ErrorCode.E_NOT_FOUND);

  // ADMIN cannot mutate a SUPER_ADMIN account.
  if (actor.role === 'ADMIN' && target.role === 'SUPER_ADMIN') {
    return error(ErrorCode.E_FORBIDDEN, 'SUPER_ADMIN 계정은 ADMIN이 수정할 수 없습니다.');
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

  // Role-change guards.
  if (dto.role !== undefined && dto.role !== target.role) {
    if (target.id === actor.id) {
      return error(ErrorCode.E_FORBIDDEN, '본인 권한은 직접 변경할 수 없습니다.');
    }
    if (dto.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
      return error(
        ErrorCode.E_FORBIDDEN,
        'SUPER_ADMIN 권한은 슈퍼관리자만 부여할 수 있습니다.',
      );
    }
    if (target.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
      return error(
        ErrorCode.E_FORBIDDEN,
        'SUPER_ADMIN 계정의 권한은 슈퍼관리자만 변경할 수 있습니다.',
      );
    }
  }

  if (dto.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: dto.organizationId },
      select: { id: true },
    });
    if (!org) {
      return error(ErrorCode.E_VALIDATION, '존재하지 않는 조직입니다.', 400, {
        field: 'organizationId',
      });
    }
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.role !== undefined ? { role: dto.role } : {}),
      ...(dto.employmentType !== undefined ? { employmentType: dto.employmentType } : {}),
      ...(dto.securityLevel !== undefined ? { securityLevel: dto.securityLevel } : {}),
      ...(dto.organizationId !== undefined ? { organizationId: dto.organizationId } : {}),
      ...(dto.signatureFile !== undefined ? { signatureFile: dto.signatureFile } : {}),
    },
    select: {
      id: true,
      username: true,
      fullName: true,
      email: true,
      role: true,
      employmentType: true,
      securityLevel: true,
      organizationId: true,
      signatureFile: true,
      lockedUntil: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      organization: { select: { id: true, name: true } },
    },
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: actor.id,
    action: 'USER_UPDATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      targetUserId: target.id,
      changes: Object.keys(dto),
    },
  });

  return ok({ ...updated, lockStatus: lockStatusFor(updated.lockedUntil) });
}

export async function DELETE(
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
  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN') {
    return error(ErrorCode.E_FORBIDDEN);
  }

  if (params.id === actor.id) {
    return error(ErrorCode.E_FORBIDDEN, '본인 계정은 삭제할 수 없습니다.');
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, role: true, deletedAt: true },
  });
  if (!target) return error(ErrorCode.E_NOT_FOUND);
  if (target.deletedAt) {
    // Already deleted — idempotent success.
    return ok({ id: target.id, deletedAt: target.deletedAt });
  }

  if (actor.role === 'ADMIN' && target.role === 'SUPER_ADMIN') {
    return error(ErrorCode.E_FORBIDDEN, 'SUPER_ADMIN 계정은 ADMIN이 삭제할 수 없습니다.');
  }

  const now = new Date();
  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      deletedAt: now,
      employmentType: EmploymentType.RETIRED,
    },
    select: { id: true, deletedAt: true },
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: actor.id,
    action: 'USER_DELETE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { targetUserId: target.id },
  });

  return ok(updated);
}
