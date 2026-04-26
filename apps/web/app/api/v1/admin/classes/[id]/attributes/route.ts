// /api/v1/admin/classes/:id/attributes
//   GET   — list ObjectAttributes for a class (sortOrder asc).
//   POST  — create a new ObjectAttribute under the class.
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

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

const createSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, '속성 코드는 영문/숫자/_-만 허용합니다.'),
  label: z.string().min(1).max(100),
  dataType: z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'COMBO']),
  required: z.boolean().optional(),
  defaultValue: z.string().max(500).nullable().optional(),
  /** Free-form JSON (typically array of strings) for COMBO option lists. */
  comboItems: z.unknown().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
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

  // 404 the class itself so the FE can distinguish "no attributes" vs "no class".
  const klass = await prisma.objectClass.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!klass) return error(ErrorCode.E_NOT_FOUND);

  const rows = await prisma.objectAttribute.findMany({
    where: { classId: klass.id },
    orderBy: { sortOrder: 'asc' },
  });

  return ok(rows);
}

export async function POST(
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
    return error(ErrorCode.E_FORBIDDEN, '속성 생성 권한이 없습니다.');
  }

  const klass = await prisma.objectClass.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!klass) return error(ErrorCode.E_NOT_FOUND);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const dto = parsed.data;

  let created;
  try {
    created = await prisma.objectAttribute.create({
      data: {
        classId: klass.id,
        code: dto.code,
        label: dto.label,
        dataType: dto.dataType,
        required: dto.required ?? false,
        defaultValue: dto.defaultValue ?? null,
        comboItems:
          dto.comboItems === undefined
            ? Prisma.JsonNull
            : (dto.comboItems as Prisma.InputJsonValue),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return error(
        ErrorCode.E_VALIDATION,
        '이미 사용 중인 속성 코드입니다.',
      );
    }
    throw e;
  }

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'ATTRIBUTE_CREATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      classId: klass.id,
      attributeId: created.id,
      code: created.code,
      label: created.label,
      dataType: created.dataType,
    },
  });

  return ok(created, undefined, { status: 201 });
}
