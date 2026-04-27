// GET  /api/v1/admin/users?limit=&cursor=&q=
// POST /api/v1/admin/users
//
// Admin user list + create (BUG-015 / FE-2 + R29 / U-2). Paginated, ordered
// by createdAt desc. Excludes passwordHash. Optional `q` substring-matches
// on username / fullName / email.
//
// Each row carries a synthesized `lockStatus`: 'LOCKED' when
// `lockedUntil > now()`, otherwise 'NONE'. The FE renders a badge from this.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by BE-2.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, Role, EmploymentType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';

const BCRYPT_ROUNDS = 12;

const querySchema = z.object({
  q: z.string().trim().min(1).optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(100, Math.max(1, parseInt(v, 10) || 50)) : 50)),
});

export async function GET(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
    return error(ErrorCode.E_FORBIDDEN);
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { q, cursor, limit } = parsed.data;

  const where: Prisma.UserWhereInput = q
    ? {
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { fullName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {};

  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      username: true,
      fullName: true,
      email: true,
      organizationId: true,
      role: true,
      employmentType: true,
      securityLevel: true,
      lastLoginAt: true,
      lockedUntil: true,
      failedLoginCount: true,
      createdAt: true,
      organization: { select: { id: true, name: true } },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;
  const now = Date.now();

  const data = page.map((u) => ({
    ...u,
    lockStatus:
      u.lockedUntil && u.lockedUntil.getTime() > now ? ('LOCKED' as const) : ('NONE' as const),
  }));

  return ok(data, { nextCursor });
}

// ── POST /api/v1/admin/users ────────────────────────────────────────────
// Body: { username, fullName, email?, role, employmentType?, securityLevel?,
//         organizationId?, password }
//
// Creates a user with a bcrypt-hashed password. SUPER_ADMIN role can only be
// granted by an existing SUPER_ADMIN.
const createSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, '아이디는 영문/숫자/._-만 사용할 수 있습니다.'),
  fullName: z.string().min(1).max(64),
  email: z.string().email().max(256).optional().or(z.literal('').transform(() => undefined)),
  role: z.nativeEnum(Role),
  employmentType: z.nativeEnum(EmploymentType).optional(),
  securityLevel: z.number().int().min(1).max(5).optional(),
  organizationId: z.string().min(1).optional().or(z.literal('').transform(() => undefined)),
  password: z.string().min(8).max(128),
});

export async function POST(req: Request): Promise<NextResponse> {
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

  // SUPER_ADMIN may only be granted by an existing SUPER_ADMIN.
  if (dto.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
    return error(ErrorCode.E_FORBIDDEN, 'SUPER_ADMIN 권한은 슈퍼관리자만 부여할 수 있습니다.');
  }

  // Ensure username is unique. The DB has a unique index but we surface a
  // friendlier 400 here.
  const existing = await prisma.user.findUnique({ where: { username: dto.username } });
  if (existing) {
    return error(ErrorCode.E_VALIDATION, '이미 사용 중인 아이디입니다.', 400, {
      field: 'username',
    });
  }

  // Verify organization exists (FK constraint would also catch this).
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

  const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

  const created = await prisma.user.create({
    data: {
      username: dto.username,
      passwordHash,
      fullName: dto.fullName,
      email: dto.email ?? null,
      role: dto.role,
      employmentType: dto.employmentType ?? EmploymentType.ACTIVE,
      securityLevel: dto.securityLevel ?? 5,
      organizationId: dto.organizationId ?? null,
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
      createdAt: true,
    },
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: actor.id,
    action: 'USER_CREATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { targetUserId: created.id, role: created.role },
  });

  return ok({ ...created, lockStatus: 'NONE' as const }, undefined, { status: 201 });
}
