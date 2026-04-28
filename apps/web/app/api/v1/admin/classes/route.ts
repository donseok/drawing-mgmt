// /api/v1/admin/classes
//   GET   — ObjectClass list with attribute summaries (BUG-015 / FE-2).
//   POST  — create a new ObjectClass (R25 카드 B).
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by BE.

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

const createSchema = z.object({
  /** Uppercased + dash-only token. Must be unique. */
  code: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/, '자료유형 코드는 영문 대문자/숫자/_-만 허용합니다.'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export async function GET(): Promise<NextResponse> {
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

  const rows = await prisma.objectClass.findMany({
    orderBy: [{ code: 'asc' }],
    include: {
      attributes: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          code: true,
          label: true,
          dataType: true,
          required: true,
          sortOrder: true,
        },
      },
      _count: { select: { objects: true } },
    },
  });

  const data = rows.map((r) => {
    const { _count, ...rest } = r;
    return { ...rest, objectCount: _count.objects };
  });

  return ok(data);
}

export const POST = withApi({ rateLimit: 'api' }, async (req: Request) => {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) {
    return error(ErrorCode.E_FORBIDDEN, '자료유형 생성 권한이 없습니다.');
  }

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
    created = await prisma.objectClass.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return error(ErrorCode.E_VALIDATION, '이미 사용 중인 코드입니다.');
    }
    throw e;
  }

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'CLASS_CREATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { classId: created.id, code: created.code, name: created.name },
  });

  return ok(created, undefined, { status: 201 });
});
