// GET /api/v1/principals?type=&q=&limit=
//
// U-5 picker endpoint (R28). One endpoint that searches USER / GROUP /
// ORGANIZATION by substring so the FE Combobox can drive the
// folder-permission matrix without three different hooks.
//
// Authorization: SUPER_ADMIN or ADMIN.
// Owner: backend.
// Contract: `_workspace/api_contract.md` §3.3.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

const querySchema = z.object({
  type: z.enum(['user', 'group', 'organization']),
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional(),
  limit: z
    .string()
    .optional()
    .transform((v) =>
      v ? Math.min(100, Math.max(1, parseInt(v, 10) || 20)) : 20,
    ),
});

interface PrincipalDTO {
  id: string;
  type: 'USER' | 'GROUP' | 'ORG';
  label: string;
  sublabel: string | null;
}

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export async function GET(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) return error(ErrorCode.E_FORBIDDEN);

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    type: url.searchParams.get('type') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { type, q, limit } = parsed.data;

  const data = await search(type, q, limit);
  return ok(data);
}

async function search(
  type: 'user' | 'group' | 'organization',
  q: string | undefined,
  limit: number,
): Promise<PrincipalDTO[]> {
  if (type === 'user') {
    const where: Prisma.UserWhereInput = {
      // R4a — never surface retired accounts in the picker.
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { username: { contains: q, mode: 'insensitive' } },
              { fullName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await prisma.user.findMany({
      where,
      orderBy: [{ fullName: 'asc' }, { username: 'asc' }],
      take: limit,
      select: { id: true, fullName: true, username: true, email: true },
    });
    return rows.map((u) => ({
      id: u.id,
      type: 'USER' as const,
      label: u.fullName || u.username,
      sublabel: u.email ?? null,
    }));
  }

  if (type === 'group') {
    const where: Prisma.GroupWhereInput = q
      ? { name: { contains: q, mode: 'insensitive' } }
      : {};
    const rows = await prisma.group.findMany({
      where,
      orderBy: { name: 'asc' },
      take: limit,
      select: { id: true, name: true },
    });
    return rows.map((g) => ({
      id: g.id,
      type: 'GROUP' as const,
      label: g.name,
      sublabel: null,
    }));
  }

  // organization
  const where: Prisma.OrganizationWhereInput = q
    ? { name: { contains: q, mode: 'insensitive' } }
    : {};
  const rows = await prisma.organization.findMany({
    where,
    orderBy: { name: 'asc' },
    take: limit,
    select: { id: true, name: true },
  });
  return rows.map((o) => ({
    id: o.id,
    type: 'ORG' as const,
    label: o.name,
    sublabel: null,
  }));
}
