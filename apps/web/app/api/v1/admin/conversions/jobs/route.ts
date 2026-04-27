// GET /api/v1/admin/conversions/jobs?status=&limit=&cursor=
//
// R28 V-INF-4 — admin monitoring feed for the DWG → DXF conversion pipeline.
// Lists ConversionJob rows with attachment + object number joined in for
// human-readable labels, plus a per-status count for the header.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by viewer-engineer (R28).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ConversionStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_VALUES = ['PENDING', 'PROCESSING', 'DONE', 'FAILED'] as const;

const querySchema = z.object({
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
  const { status, cursor, limit } = parsed.data;

  const where: Prisma.ConversionJobWhereInput = status ? { status } : {};

  const [rows, statsRaw] = await Promise.all([
    prisma.conversionJob.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        attachmentId: true,
        status: true,
        attempt: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        attachment: {
          select: {
            filename: true,
            version: {
              select: {
                revision: {
                  select: {
                    object: {
                      select: { number: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.conversionJob.groupBy({
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
      attachmentId: row.attachmentId,
      attachmentFilename: row.attachment?.filename ?? null,
      objectNumber:
        row.attachment?.version?.revision?.object?.number ?? null,
      status: row.status,
      attempt: row.attempt,
      errorMessage: row.errorMessage,
      startedAt: startedAt?.toISOString() ?? null,
      finishedAt: finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      durationMs,
    };
  });

  // Always populate every status key so the FE doesn't have to defend
  // against missing entries.
  const stats: Record<ConversionStatus, number> = {
    PENDING: 0,
    PROCESSING: 0,
    DONE: 0,
    FAILED: 0,
  };
  for (const row of statsRaw) {
    stats[row.status] = row._count._all;
  }

  return ok(data, { stats, nextCursor });
}
