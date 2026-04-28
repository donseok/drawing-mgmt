// GET /api/v1/admin/pdf-extracts?status=&cursor=&limit=
//
// R41 / A — admin monitoring feed for the `pdf-extract` queue (R40 introduced
// the worker; this round adds visibility + retry). Lists Attachment rows with
// their pdfExtractStatus, the parent ObjectEntity number for human labels, and
// per-status counts for the header badges.
//
// Mirrors GET /api/v1/admin/scans (R36 V-INF-3) so the admin UI can reuse the
// same stats card + table pattern. The shared shape is:
//   data: Attachment[]   (status-specific subset of columns)
//   meta: { stats, nextCursor, hasMore }
// — except the contract here surfaces `counts` (named for the FE filter chips)
// instead of `stats`. Both names map to the same per-status groupBy result.
//
// Authorization: SUPER_ADMIN or ADMIN (admin-only operational view).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, PdfExtractStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_VALUES = [
  'PENDING',
  'EXTRACTING',
  'DONE',
  'FAILED',
  'SKIPPED',
] as const satisfies readonly PdfExtractStatus[];

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
    ? { pdfExtractStatus: status }
    : {};

  // contentText length is needed for the "indexed N chars" hint in the
  // admin table. Fetching the full string just to length-check it is
  // wasteful when a row could carry hundreds of KB; ask Postgres for
  // CHAR_LENGTH directly via $queryRaw is overkill though — Prisma's
  // generated types already require the column. The pragmatic compromise:
  // use a separate raw count query for `contentLength` only on the
  // already-paginated id list. Keeps the main read narrow.
  const [rows, statsRaw] = await Promise.all([
    prisma.attachment.findMany({
      where,
      // Newest first — admins triaging failures want the most recent rows
      // visible. Secondary by id keeps the cursor stable across same-second
      // creation (Postgres clock resolution).
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        filename: true,
        mimeType: true,
        pdfExtractStatus: true,
        pdfExtractAt: true,
        pdfExtractError: true,
        createdAt: true,
        // contentText is potentially large; we only need its length. Use
        // a server-side aggregation instead — see below.
        version: {
          select: {
            revision: {
              select: {
                object: {
                  select: { id: true, number: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.attachment.groupBy({
      by: ['pdfExtractStatus'],
      _count: { _all: true },
    }),
  ]);

  // Per-row contentText length without dragging the full body across the
  // wire. Run a single bulk SELECT for the paginated id slice — cheap
  // (we capped limit to 100) and avoids the per-row N+1.
  const ids = rows.map((r) => r.id);
  const lengthRows = ids.length
    ? await prisma.$queryRaw<Array<{ id: string; len: number | null }>>(
        Prisma.sql`SELECT "id", CHAR_LENGTH("contentText") AS "len"
                   FROM "Attachment"
                   WHERE "id" IN (${Prisma.join(ids)})`,
      )
    : [];
  const lengthById = new Map<string, number | null>();
  for (const r of lengthRows) {
    // Postgres CHAR_LENGTH returns BIGINT for very large strings — Prisma
    // hands us a `number` for INT4 but bigint for INT8. Defensive coerce.
    const v = r.len;
    lengthById.set(
      r.id,
      v === null || v === undefined ? null : typeof v === 'bigint' ? Number(v) : v,
    );
  }

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.id ?? null : null;

  const data = sliced.map((row) => ({
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    pdfExtractStatus: row.pdfExtractStatus,
    pdfExtractAt: row.pdfExtractAt?.toISOString() ?? null,
    pdfExtractError: row.pdfExtractError,
    contentLength: lengthById.get(row.id) ?? null,
    createdAt: row.createdAt.toISOString(),
    objectId: row.version?.revision?.object?.id ?? null,
    objectNumber: row.version?.revision?.object?.number ?? null,
  }));

  // Always populate every status key so the FE doesn't have to defend
  // against missing entries.
  const counts: Record<PdfExtractStatus, number> = {
    PENDING: 0,
    EXTRACTING: 0,
    DONE: 0,
    FAILED: 0,
    SKIPPED: 0,
  };
  for (const row of statsRaw) {
    counts[row.pdfExtractStatus] = row._count._all;
  }

  return ok(data, { counts, nextCursor, hasMore });
}
