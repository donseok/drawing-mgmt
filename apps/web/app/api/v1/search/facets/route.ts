/**
 * GET /api/v1/search/facets
 *
 * Returns counts of the values the current user could further narrow to,
 * given the same filter context as `/api/v1/objects`. The response shape:
 *
 *   {
 *     classes: [{ code, label, count }],
 *     states:  [{ value, label, count }],
 *     owners:  [{ id, name, count }]
 *   }
 *
 * Counts are computed on the *visible* (post-permission-filtered) result set.
 * Because permissions are evaluated per row in the application layer (not in
 * SQL), we materialize candidate ids first, then aggregate in memory. The
 * candidate ceiling (FACET_CANDIDATE_CAP) keeps the response bounded — the
 * UI only uses these as filter chips, not as exact analytics.
 *
 * BUG-007 — search facets endpoint.
 */

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
import { collectFolderSubtreeIds } from '@/lib/folders';

const FACET_CANDIDATE_CAP = 1000;

const STATE_LABELS: Record<ObjectState, string> = {
  NEW: '신규',
  CHECKED_OUT: '체크아웃',
  CHECKED_IN: '체크인',
  IN_APPROVAL: '결재 중',
  APPROVED: '승인 완료',
  DELETED: '폐기',
};

const querySchema = z.object({
  folderId: z.string().optional(),
  q: z.string().trim().min(1).optional(),
  classCode: z.string().optional(),
  state: z.nativeEnum(ObjectState).optional(),
  dateRange: z.string().optional(),
  ownerId: z.string().min(1).optional(),
  lockedOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  securityLevelMin: z
    .string()
    .optional()
    .transform((v) => (v !== undefined && v !== '' ? parseInt(v, 10) : undefined))
    .refine(
      (v) => v === undefined || (Number.isInteger(v) && v >= 1 && v <= 5),
      { message: 'securityLevelMin must be 1..5' },
    ),
  securityLevelMax: z
    .string()
    .optional()
    .transform((v) => (v !== undefined && v !== '' ? parseInt(v, 10) : undefined))
    .refine(
      (v) => v === undefined || (Number.isInteger(v) && v >= 1 && v <= 5),
      { message: 'securityLevelMax must be 1..5' },
    ),
  includeTrash: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  mineOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

interface FacetsResponse {
  classes: Array<{ code: string; label: string; count: number }>;
  states: Array<{ value: ObjectState; label: string; count: number }>;
  owners: Array<{ id: string; name: string; count: number }>;
}

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
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const q = parsed.data;

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);

  // Build the same WHERE clause as /objects.
  const where: Prisma.ObjectEntityWhereInput = {};
  if (q.folderId) {
    const ids = await collectFolderSubtreeIds(q.folderId);
    where.folderId = { in: ids };
  }
  if (q.state) where.state = q.state;
  if (q.classCode) where.class = { code: q.classCode };
  if (!q.includeTrash) where.deletedAt = null;
  else where.state = ObjectState.DELETED;
  if (q.mineOnly) where.ownerId = user.id;
  if (!q.mineOnly && q.ownerId) where.ownerId = q.ownerId;
  if (q.lockedOnly) where.lockedById = { not: null };
  if (q.securityLevelMin !== undefined || q.securityLevelMax !== undefined) {
    where.securityLevel = {
      ...(q.securityLevelMin !== undefined ? { gte: q.securityLevelMin } : {}),
      ...(q.securityLevelMax !== undefined ? { lte: q.securityLevelMax } : {}),
    };
  }
  if (q.dateRange) {
    const range = parseDateRange(q.dateRange);
    if (range) where.createdAt = { gte: range.from, lt: range.to };
  }

  // Optional similarity narrowing — same `q.q` semantics as /objects.
  if (q.q) {
    const term = q.q.trim();
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "ObjectEntity"
      WHERE (
        similarity("number", ${term}) > 0.1
        OR similarity("name", ${term}) > 0.1
        OR ("description" IS NOT NULL AND similarity("description", ${term}) > 0.1)
      )
      LIMIT ${FACET_CANDIDATE_CAP}
    `;
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return ok<FacetsResponse>({ classes: [], states: [], owners: [] });
    }
    where.id = { in: ids };
  }

  const candidates = await prisma.objectEntity.findMany({
    where,
    take: FACET_CANDIDATE_CAP,
    select: {
      id: true,
      folderId: true,
      ownerId: true,
      securityLevel: true,
      state: true,
      classId: true,
    },
  });

  // Apply same per-row VIEW permission filter as /objects.
  const folderIds = Array.from(new Set(candidates.map((r) => r.folderId)));
  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions(folderIds),
  ]);
  const visible = candidates.filter((r) =>
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

  // Tally facets in-memory — fast at FACET_CANDIDATE_CAP scale.
  const classCounts = new Map<string, number>(); // classId -> count
  const stateCounts = new Map<ObjectState, number>();
  const ownerCounts = new Map<string, number>();
  for (const r of visible) {
    classCounts.set(r.classId, (classCounts.get(r.classId) ?? 0) + 1);
    stateCounts.set(r.state, (stateCounts.get(r.state) ?? 0) + 1);
    ownerCounts.set(r.ownerId, (ownerCounts.get(r.ownerId) ?? 0) + 1);
  }

  // Resolve labels via single batched lookups.
  const classIds = [...classCounts.keys()];
  const ownerIds = [...ownerCounts.keys()];
  const [classRows, ownerRows] = await Promise.all([
    classIds.length > 0
      ? prisma.objectClass.findMany({
          where: { id: { in: classIds } },
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve([]),
    ownerIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
  ]);

  const classes = classRows
    .map((c) => ({
      code: c.code,
      label: c.name,
      count: classCounts.get(c.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  const states = [...stateCounts.entries()]
    .map(([value, count]) => ({
      value,
      label: STATE_LABELS[value] ?? value,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const owners = ownerRows
    .map((u) => ({
      id: u.id,
      name: u.fullName,
      count: ownerCounts.get(u.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  return ok<FacetsResponse>(
    { classes, states, owners },
    { totalVisible: visible.length, totalCandidates: candidates.length, capped: candidates.length >= FACET_CANDIDATE_CAP },
  );
}


function parseDateRange(s: string): { from: Date; to: Date } | null {
  const range = s.split('..');
  if (range.length === 2) {
    const from = parseDate(range[0]!);
    const to = parseDate(range[1]!, true);
    if (from && to) return { from, to };
    return null;
  }
  const from = parseDate(s);
  const to = parseDate(s, true);
  if (!from || !to) return null;
  return { from, to };
}

function parseDate(s: string, end = false): Date | null {
  if (/^\d{4}$/.test(s)) {
    const y = parseInt(s, 10);
    return end ? new Date(y + 1, 0, 1) : new Date(y, 0, 1);
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [yStr, mStr] = s.split('-');
    const y = parseInt(yStr!, 10);
    const m = parseInt(mStr!, 10) - 1;
    return end ? new Date(y, m + 1, 1) : new Date(y, m, 1);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    if (end) return new Date(d.getTime() + 24 * 60 * 60 * 1000);
    return d;
  }
  return null;
}
