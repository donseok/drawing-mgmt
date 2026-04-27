// GET /api/v1/admin/backups?kind=&status=&limit=&cursor=
//
// R33 / D-5 — admin monitoring feed for the backup pipeline. Lists Backup
// rows newest-first plus per-status counts so the dashboard header can
// render "RUNNING/DONE/FAILED" badges without an extra round-trip.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by backend (R33 D-5).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BackupKind, BackupStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_VALUES = ['RUNNING', 'DONE', 'FAILED'] as const;
const KIND_VALUES = ['POSTGRES', 'FILES'] as const;

const querySchema = z.object({
  kind: z.enum(KIND_VALUES).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  cursor: z.string().min(1).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) =>
      v ? Math.min(100, Math.max(1, parseInt(v, 10) || 50)) : 50,
    ),
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
    kind: url.searchParams.get('kind') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const { kind, status, cursor, limit } = parsed.data;

  const where: Prisma.BackupWhereInput = {
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
  };

  const [rows, statsRaw] = await Promise.all([
    prisma.backup.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        kind: true,
        status: true,
        storagePath: true,
        sizeBytes: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
    prisma.backup.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.id ?? null : null;

  const data = sliced.map((row) => {
    const startedAt = row.startedAt;
    const finishedAt = row.finishedAt;
    const durationMs =
      startedAt && finishedAt
        ? finishedAt.getTime() - startedAt.getTime()
        : null;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      // Don't leak the absolute filesystem path to admins — just expose the
      // basename so the UI can label rows. Full path lives server-side and
      // is consumed only by the download endpoint.
      storageBasename: row.storagePath
        ? row.storagePath.split(/[\\/]/).pop() ?? null
        : null,
      sizeBytes: row.sizeBytes !== null ? row.sizeBytes.toString() : null,
      errorMessage: row.errorMessage,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt?.toISOString() ?? null,
      durationMs,
    };
  });

  // Always populate every status key so the FE doesn't have to defend
  // against missing entries.
  const stats: Record<BackupStatus, number> = {
    RUNNING: 0,
    DONE: 0,
    FAILED: 0,
  };
  for (const row of statsRaw) {
    stats[row.status] = row._count._all;
  }

  // Acknowledge unused enum import for typescript (BackupKind is exported
  // here to keep the contract parallel; future kind=`FILES` filter UI uses it).
  void BackupKind;

  return ok(data, { stats, nextCursor });
}
