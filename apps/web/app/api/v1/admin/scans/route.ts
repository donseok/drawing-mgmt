// GET /api/v1/admin/scans?status=&cursor=&limit=
//
// R36 V-INF-3 — admin monitoring feed for the ClamAV virus-scan pipeline.
// Lists Attachment rows with their virusScanStatus + the parent object
// number/filename joined in for human-readable labels, plus a per-status
// count for the header badge.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Mirrors the shape of GET /api/v1/admin/conversions/jobs (R28) so the
// admin UI can reuse the same stats card + table pattern.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, VirusScanStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_VALUES = [
  'PENDING',
  'SCANNING',
  'CLEAN',
  'INFECTED',
  'SKIPPED',
  'FAILED',
] as const;

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

  const where: Prisma.AttachmentWhereInput = status
    ? { virusScanStatus: status }
    : {};

  const [rows, statsRaw] = await Promise.all([
    prisma.attachment.findMany({
      where,
      // Surface most recently created first; secondary by id keeps the
      // cursor stable across timestamps.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        filename: true,
        size: true,
        mimeType: true,
        virusScanStatus: true,
        virusScanSig: true,
        virusScanAt: true,
        createdAt: true,
        version: {
          select: {
            revision: {
              select: {
                object: {
                  select: { id: true, number: true, name: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.attachment.groupBy({
      by: ['virusScanStatus'],
      _count: { _all: true },
    }),
  ]);

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.id ?? null : null;

  const data = sliced.map((row) => ({
    attachmentId: row.id,
    attachmentFilename: row.filename,
    size: row.size.toString(),
    mimeType: row.mimeType,
    virusScanStatus: row.virusScanStatus,
    virusScanSig: row.virusScanSig,
    virusScanAt: row.virusScanAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    objectId: row.version?.revision?.object?.id ?? null,
    objectNumber: row.version?.revision?.object?.number ?? null,
    objectName: row.version?.revision?.object?.name ?? null,
  }));

  // Always populate every status key so the FE doesn't have to defend
  // against missing entries.
  const stats: Record<VirusScanStatus, number> = {
    PENDING: 0,
    SCANNING: 0,
    CLEAN: 0,
    INFECTED: 0,
    SKIPPED: 0,
    FAILED: 0,
  };
  for (const row of statsRaw) {
    stats[row.virusScanStatus] = row._count._all;
  }

  return ok(data, { stats, nextCursor });
}
