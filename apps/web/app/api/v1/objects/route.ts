// /api/v1/objects
//   GET  — search/list with cursor pagination, filtered by user permissions.
//   POST — create a new ObjectEntity (state=NEW, currentRevision=0).
//
// Search query (`q`) uses pg_trgm similarity when provided. Other filters are
// straightforward where-clauses. Cursor is the last item's id (ULID-style
// ordering by createdAt DESC, id DESC for stability).
//
// TRD §6.2.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, ObjectState } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  loadFolderPermissions,
  toPermissionUser,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { evaluateNumberRule } from '@/lib/db-helpers';

const querySchema = z.object({
  folderId: z.string().optional(),
  q: z.string().trim().min(1).optional(),
  classCode: z.string().optional(),
  state: z.nativeEnum(ObjectState).optional(),
  dateRange: z.string().optional(), // e.g. "2026" or "2026-01..2026-06"
  includeTrash: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  mineOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(100, Math.max(1, parseInt(v, 10) || 50)) : 50)),
});

const createSchema = z.object({
  folderId: z.string().min(1),
  classId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  securityLevel: z.number().int().min(1).max(5).default(5),
  /** Optional manual number override — falls back to rule generator. */
  number: z.string().min(1).max(64).optional(),
  attributes: z
    .array(
      z.object({
        attributeId: z.string().min(1),
        value: z.string().max(1000),
      }),
    )
    .optional(),
});

type ObjectSummary = {
  id: string;
  number: string;
  name: string;
  description: string | null;
  folderId: string;
  classId: string;
  securityLevel: number;
  state: ObjectState;
  ownerId: string;
  currentRevision: number;
  currentVersion: string;
  lockedById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function GET(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const q = parsed.data;

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);

  // Build the WHERE clause for non-search filters.
  const where: Prisma.ObjectEntityWhereInput = {};
  if (q.folderId) where.folderId = q.folderId;
  if (q.state) where.state = q.state;
  if (q.classCode) where.class = { code: q.classCode };
  if (!q.includeTrash) where.deletedAt = null;
  else where.state = ObjectState.DELETED;
  if (q.mineOnly) where.ownerId = user.id;

  if (q.dateRange) {
    const range = parseDateRange(q.dateRange);
    if (range) where.createdAt = { gte: range.from, lt: range.to };
  }

  // Cursor pagination
  let cursor: Prisma.ObjectEntityWhereUniqueInput | undefined;
  if (q.cursor) cursor = { id: q.cursor };

  // q (full-text/trigram). When present, we use a raw SQL query for similarity
  // ordering then filter via the in-list. Otherwise use Prisma's findMany.
  let candidateIds: string[] | null = null;
  if (q.q) {
    const term = q.q.trim();
    // pg_trgm similarity on number/name/description; threshold 0.1 to be permissive.
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "ObjectEntity"
      WHERE (
        similarity("number", ${term}) > 0.1
        OR similarity("name", ${term}) > 0.1
        OR ("description" IS NOT NULL AND similarity("description", ${term}) > 0.1)
      )
      ORDER BY GREATEST(
        similarity("number", ${term}),
        similarity("name", ${term}),
        COALESCE(similarity("description", ${term}), 0)
      ) DESC
      LIMIT 500
    `;
    candidateIds = rows.map((r) => r.id);
    if (candidateIds.length === 0) {
      return ok<ObjectSummary[]>([], { nextCursor: null, hasMore: false });
    }
    where.id = { in: candidateIds };
  }

  const limit = q.limit;
  const rows = await prisma.objectEntity.findMany({
    where,
    cursor,
    skip: cursor ? 1 : 0,
    take: limit + 1, // fetch one extra to detect hasMore
    orderBy: q.q
      ? undefined // already ordered by similarity above; preserve that order client-side
      : [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      number: true,
      name: true,
      description: true,
      folderId: true,
      classId: true,
      securityLevel: true,
      state: true,
      ownerId: true,
      currentRevision: true,
      currentVersion: true,
      lockedById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Permission filter — pre-load folder permissions for the union of folder ids.
  const folderIds = Array.from(new Set(rows.map((r) => r.folderId)));
  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions(folderIds),
  ]);

  const allowed = rows.filter((r) =>
    canAccess(
      pUser,
      {
        id: r.id,
        folderId: r.folderId,
        ownerId: r.ownerId,
        securityLevel: r.securityLevel,
      },
      perms,
      'VIEW',
    ).allowed,
  );

  // If we used similarity, restore similarity order.
  let ordered = allowed;
  if (candidateIds && candidateIds.length > 0) {
    const rank = new Map(candidateIds.map((id, i) => [id, i] as const));
    ordered = [...allowed].sort(
      (a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9),
    );
  }

  const hasMore = ordered.length > limit;
  const page = hasMore ? ordered.slice(0, limit) : ordered;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;

  // Normalize Decimal -> string for JSON safety.
  const data: ObjectSummary[] = page.map((r) => ({
    ...r,
    currentVersion: r.currentVersion.toString(),
  }));

  return ok(data, { nextCursor, hasMore });
}

export async function POST(req: Request): Promise<NextResponse> {
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const dto = parsed.data;

  // Permission: user must have EDIT on the target folder. We synthesize a
  // would-be object using user.securityLevel so the SL check passes for the
  // creator (i.e. they can create at any SL ≥ their own clearance). Owner
  // bypass also lets the creator subsequently access it.
  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);

  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions([dto.folderId]),
  ]);
  const decision = canAccess(
    pUser,
    {
      id: '',
      folderId: dto.folderId,
      ownerId: user.id,
      securityLevel: dto.securityLevel,
    },
    perms,
    'EDIT',
  );
  if (!decision.allowed) return error(ErrorCode.E_FORBIDDEN, decision.reason);

  // Resolve drawing number — prefer manual, else rule.
  let number = dto.number;
  if (!number) {
    // Pick a rule: class-bound rule first (preferring isDefault), else the
    // global default. If neither exists, require a manual number.
    const rule =
      (await prisma.numberRule.findFirst({
        where: { classId: dto.classId },
        orderBy: { isDefault: 'desc' },
        include: { parts: { orderBy: { order: 'asc' } } },
      })) ??
      (await prisma.numberRule.findFirst({
        where: { isDefault: true, classId: null },
        include: { parts: { orderBy: { order: 'asc' } } },
      }));

    if (!rule) {
      return error(
        ErrorCode.E_VALIDATION,
        '도면번호 자동발번 규칙이 설정되지 않았습니다. 수동 입력하세요.',
      );
    }

    const folder = await prisma.folder.findUnique({
      where: { id: dto.folderId },
      select: { folderCode: true },
    });
    if (!folder) return error(ErrorCode.E_NOT_FOUND, '폴더를 찾을 수 없습니다.');

    // Retry on unique-violation a couple of times in case of a race.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const candidate = await evaluateNumberRule(
          { id: rule.id, name: rule.name, parts: rule.parts },
          { folderCode: folder.folderCode },
          prisma,
        );
        const created = await createObject(dto, candidate, user.id);
        await logCreate(req, user.id, created.id);
        return ok(created, undefined, { status: 201 });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue; // unique violation — retry
        }
        throw err;
      }
    }
    return error(
      ErrorCode.E_INTERNAL,
      '도면번호 자동발번에 반복 실패했습니다. 다시 시도하세요.',
    );
  }

  // Manual number path
  try {
    const created = await createObject(dto, number, user.id);
    await logCreate(req, user.id, created.id);
    return ok(created, undefined, { status: 201 });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return error(ErrorCode.E_VALIDATION, '이미 존재하는 도면번호입니다.');
    }
    throw err;
  }
}

async function createObject(
  dto: z.infer<typeof createSchema>,
  number: string,
  userId: string,
) {
  return prisma.$transaction(async (tx) => {
    const obj = await tx.objectEntity.create({
      data: {
        number,
        name: dto.name,
        description: dto.description ?? null,
        folderId: dto.folderId,
        classId: dto.classId,
        securityLevel: dto.securityLevel,
        ownerId: userId,
        state: ObjectState.NEW,
        currentRevision: 0,
        currentVersion: 0,
      },
    });
    if (dto.attributes && dto.attributes.length > 0) {
      await tx.objectAttributeValue.createMany({
        data: dto.attributes.map((a) => ({
          objectId: obj.id,
          attributeId: a.attributeId,
          value: a.value,
        })),
      });
    }
    // Initial revision 0 to mirror currentRevision.
    await tx.revision.create({
      data: { objectId: obj.id, rev: 0 },
    });
    return obj;
  });
}

async function logCreate(req: Request, userId: string, objectId: string) {
  const meta = extractRequestMeta(req);
  await logActivity({
    userId,
    action: 'OBJECT_CREATE',
    objectId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

/**
 * Parse a `dateRange` query value.
 *   "2026"            → entire year 2026
 *   "2026-04"         → April 2026
 *   "2026-01..2026-06" → Jan 1 2026 .. Jul 1 2026 (exclusive)
 */
function parseDateRange(s: string): { from: Date; to: Date } | null {
  const range = s.split('..');
  if (range.length === 2) {
    const from = parseDate(range[0]!);
    const to = parseDate(range[1]!, /*end*/ true);
    if (from && to) return { from, to };
    return null;
  }
  const from = parseDate(s);
  const to = parseDate(s, true);
  if (!from || !to) return null;
  return { from, to };
}

function parseDate(s: string, end = false): Date | null {
  // YYYY
  if (/^\d{4}$/.test(s)) {
    const y = parseInt(s, 10);
    return end ? new Date(y + 1, 0, 1) : new Date(y, 0, 1);
  }
  // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [yStr, mStr] = s.split('-');
    const y = parseInt(yStr!, 10);
    const m = parseInt(mStr!, 10) - 1;
    return end ? new Date(y, m + 1, 1) : new Date(y, m, 1);
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    if (end) return new Date(d.getTime() + 24 * 60 * 60 * 1000);
    return d;
  }
  return null;
}
