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
import { withApi } from '@/lib/api-helpers';

const SORT_FIELDS = ['registeredAt', 'number', 'name', 'revision', 'state'] as const;
const SORT_DIRS = ['asc', 'desc'] as const;

const querySchema = z.object({
  folderId: z.string().optional(),
  q: z.string().trim().min(1).optional(),
  classCode: z.string().optional(),
  state: z.nativeEnum(ObjectState).optional(),
  dateRange: z.string().optional(), // e.g. "2026" or "2026-01..2026-06"
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
  sortBy: z.enum(SORT_FIELDS).optional(),
  sortDir: z.enum(SORT_DIRS).optional(),
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
  classCode: string;
  className: string;
  securityLevel: number;
  state: ObjectState;
  ownerId: string;
  ownerName: string;
  currentRevision: number;
  currentVersion: string;
  lockedById: string | null;
  masterAttachmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * R40 S-1 — `ts_headline` snippet (plain text with `<b>...</b>` markers
   * around matched lexemes) when `q` matches a PDF attachment's
   * `contentText`. `null` when:
   *   - no `q` was provided, or
   *   - the match was on `number` / `name` / `description` (trgm path)
   *     instead of PDF body, or
   *   - no PDF attachment for this object had searchable contentText.
   * The FE renders the marker via JSX `<mark>` (split on `<b>...</b>`),
   * NEVER via `dangerouslySetInnerHTML`.
   */
  pdfSnippet: string | null;
  /**
   * R42 — which match source produced this row. `null` when no `q` was
   * searched. `'meta'` for trgm hits on number/name/description, `'pdf'`
   * for PDF body FTS hits, `'both'` when the object matched on both
   * channels. Used by the FE to render a small "본문" / "메타" chip.
   */
  matchSource: 'meta' | 'pdf' | 'both' | null;
};

/**
 * R42 — internal candidate hit when `q` is present. `score` is the unified
 * ranking key used to sort rows on the first page (no cursor / no explicit
 * sortBy). trgm `similarity` and ts_rank are both roughly 0..1 ranges, so
 * `FTS_WEIGHT` slightly biases PDF body matches above weak meta matches.
 */
type Hit = {
  id: string;
  score: number;
  source: 'meta' | 'pdf' | 'both';
  snippet: string | null;
};

/** Multiplier applied to `ts_rank` before max-merging with trgm similarity. */
const FTS_WEIGHT = 1.5;

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
  if (q.folderId) {
    // Selecting a folder includes its descendants — without this, picking
    // 본사(ROOT) returns 0 because seeded objects live under child folders.
    const ids = await collectFolderSubtreeIds(q.folderId);
    where.folderId = { in: ids };
  }
  if (q.state) where.state = q.state;
  if (q.classCode) where.class = { code: q.classCode };
  if (!q.includeTrash) where.deletedAt = null;
  else where.state = ObjectState.DELETED;
  if (q.mineOnly) where.ownerId = user.id;
  // mineOnly takes precedence; explicit ownerId filter only applies otherwise.
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

  // Cursor pagination
  let cursor: Prisma.ObjectEntityWhereUniqueInput | undefined;
  if (q.cursor) cursor = { id: q.cursor };

  // q (full-text/trigram + PDF body FTS). When present, we union two
  // candidate id sets:
  //   1) pg_trgm similarity over number/name/description (existing path).
  //   2) R40 S-1 — to_tsquery('simple', $1) @@ Attachment.content_tsv,
  //      walking Attachment → Version → Revision → ObjectEntity to lift
  //      the matching attachment row to its owning object. We also pull
  //      a `ts_headline` snippet here so the FE can show a PDF body
  //      excerpt under the result card.
  //
  // The two sources are OR-unioned (a PDF body match for object O AND a
  // trgm match on object O's number both contribute to the candidate
  // set). When we don't have a snippet for an object the FE renders no
  // body block — `pdfSnippet` is null in the response.
  let candidateIds: string[] | null = null;
  // attachment-FTS-only — object_id → ts_headline snippet (first match
  // wins; multiple PDFs per object collapse to the first hit). null
  // entries are not inserted; absence in the map means "trgm path".
  const pdfSnippetById = new Map<string, string>();
  // R42 — object_id → which match source produced this row. Populated
  // alongside the unified hit map below; queried at response-assembly
  // time so the FE can show a "본문" / "메타" chip.
  const matchSourceById = new Map<string, 'meta' | 'pdf' | 'both'>();
  if (q.q) {
    const term = q.q.trim();

    // 1) pg_trgm similarity on number/name/description; threshold 0.1
    //    to be permissive. R42 — exposes the GREATEST() result as
    //    `score` so we can max-merge with FTS rank below.
    const trgmRows = await prisma.$queryRaw<
      Array<{ id: string; score: number }>
    >`
      SELECT
        id,
        GREATEST(
          similarity("number", ${term}),
          similarity("name", ${term}),
          COALESCE(similarity("description", ${term}), 0)
        ) AS score
      FROM "ObjectEntity"
      WHERE (
        similarity("number", ${term}) > 0.1
        OR similarity("name", ${term}) > 0.1
        OR ("description" IS NOT NULL AND similarity("description", ${term}) > 0.1)
      )
      ORDER BY score DESC
      LIMIT 500
    `;

    // 2) R40 S-1 + R42 — PDF body FTS. The `content_tsv` GENERATED
    //    column (migration 0014) lets us hit a GIN index for O(log N)
    //    lookups. `plainto_tsquery` is intentional: user input is
    //    unsanitized free text and `to_tsquery` would syntax-error on
    //    punctuation. `ts_headline` gives us a `<b>...</b>`-marked
    //    excerpt the FE renders via JSX <mark> (NEVER
    //    dangerouslySetInnerHTML — see contract §8 risk row 2). R42
    //    adds `ts_rank` so the unified merge below can compare strong
    //    PDF body hits against trgm similarity.
    const ftsRows = await prisma.$queryRaw<
      Array<{ object_id: string; rank: number; snippet: string | null }>
    >`
      SELECT
        o.id AS object_id,
        ts_rank(a."content_tsv", plainto_tsquery('simple', ${term})) AS rank,
        ts_headline(
          'simple',
          a."contentText",
          plainto_tsquery('simple', ${term}),
          'StartSel=<b>,StopSel=</b>,MaxFragments=3,MaxWords=15,MinWords=4,FragmentDelimiter= … '
        ) AS snippet
      FROM "Attachment"   a
      JOIN "Version"      v ON v.id = a."versionId"
      JOIN "Revision"     r ON r.id = v."revisionId"
      JOIN "ObjectEntity" o ON o.id = r."objectId"
      WHERE a."content_tsv" @@ plainto_tsquery('simple', ${term})
      ORDER BY rank DESC
      LIMIT 500
    `;

    // R42 — unified hit map. trgm seeds with `meta` source; FTS rows
    // either upgrade an existing entry to `both` (taking max score) or
    // create a fresh `pdf` entry. Final ordering is by descending
    // unified score, breaking ties by trgm-then-FTS arrival order
    // (Map iteration order matches insertion order in JS).
    const hitMap = new Map<string, Hit>();
    for (const r of trgmRows) {
      hitMap.set(r.id, {
        id: r.id,
        score: r.score,
        source: 'meta',
        snippet: null,
      });
    }
    for (const r of ftsRows) {
      const weighted = (r.rank ?? 0) * FTS_WEIGHT;
      const existing = hitMap.get(r.object_id);
      if (existing) {
        existing.score = Math.max(existing.score, weighted);
        existing.source = 'both';
        if (existing.snippet === null) existing.snippet = r.snippet;
      } else {
        hitMap.set(r.object_id, {
          id: r.object_id,
          score: weighted,
          source: 'pdf',
          snippet: r.snippet,
        });
      }
    }

    const merged = [...hitMap.values()].sort((a, b) => b.score - a.score);

    // Build the snippet + matchSource maps from the unified hits so
    // they share a single source of truth.
    for (const h of merged) {
      if (h.snippet) pdfSnippetById.set(h.id, h.snippet);
      matchSourceById.set(h.id, h.source);
    }

    candidateIds = merged.map((h) => h.id);
    if (candidateIds.length === 0) {
      return ok<ObjectSummary[]>([], { nextCursor: null, hasMore: false });
    }
    where.id = { in: candidateIds };
  }

  const limit = q.limit;
  const sortDir: 'asc' | 'desc' = q.sortDir ?? 'desc';
  // Map UI-friendly sort keys to Prisma field names.
  const sortField = ((): keyof Prisma.ObjectEntityOrderByWithRelationInput => {
    switch (q.sortBy) {
      case 'number':
        return 'number';
      case 'name':
        return 'name';
      case 'revision':
        return 'currentRevision';
      case 'state':
        return 'state';
      case 'registeredAt':
      default:
        return 'createdAt';
    }
  })();
  const orderBy: Prisma.ObjectEntityOrderByWithRelationInput[] = [
    { [sortField]: sortDir } as Prisma.ObjectEntityOrderByWithRelationInput,
    { id: sortDir },
  ];

  // R43 — accurate cursor+ranking pagination for q + !sortBy mode. Instead
  // of relying on Prisma's createdAt/id cursor (which loses unified-rank
  // ordering on page 2+), we paginate the candidateIds array by position.
  // Cursor is interpreted as "the last id of the previous page"; we look
  // up its position in idxMap and slice from position+1. If the cursor id
  // isn't in candidateIds anymore (q changed, dataset mutated), fall back
  // to first page (position 0). Per-page over-fetch buffer is `limit*2`
  // (capped at 100) to compensate for permission-denied rows; remaining
  // gaps roll forward via nextCursor.
  const useRankedPagination =
    q.q !== undefined && !q.sortBy && candidateIds !== null && candidateIds.length > 0;

  const selectShape = {
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
    class: { select: { code: true, name: true } },
    owner: { select: { fullName: true } },
    revisions: {
      orderBy: { rev: 'desc' as const },
      take: 1,
      select: {
        versions: {
          orderBy: { ver: 'desc' as const },
          take: 1,
          select: {
            attachments: {
              where: { isMaster: true },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    },
  } satisfies Prisma.ObjectEntitySelect;

  let page: Array<Prisma.ObjectEntityGetPayload<{ select: typeof selectShape }>>;
  let nextCursor: string | null;
  let hasMore: boolean;

  if (useRankedPagination) {
    // candidateIds is non-null & non-empty here per useRankedPagination guard.
    const ids = candidateIds!;
    const idxMap = new Map(ids.map((id, i) => [id, i] as const));

    // Resolve start position from cursor; missing cursor (or stale id not
    // in current candidateIds) falls back to the first page.
    let startPos = 0;
    if (q.cursor) {
      const pos = idxMap.get(q.cursor);
      startPos = pos !== undefined ? pos + 1 : 0;
    }

    // Over-fetch buffer to absorb permission-denied rows. Capped to keep
    // a single round-trip cheap; gaps roll forward via nextCursor.
    const bufferSize = Math.min(limit * 2, 100);
    const sliceEnd = Math.min(ids.length, startPos + bufferSize);
    const idSlice = ids.slice(startPos, sliceEnd);

    if (idSlice.length === 0) {
      page = [];
      nextCursor = null;
      hasMore = false;
    } else {
      // Pull the row payloads. We do NOT pass cursor/take/orderBy here —
      // ordering is reasserted client-side via idxMap because the slice
      // is already in unified-ranking order.
      const rows = await prisma.objectEntity.findMany({
        where: { ...where, id: { in: idSlice } },
        select: selectShape,
      });

      // Permission filter on the buffered slice.
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

      // Restore unified-ranking order: rows came back in arbitrary DB
      // order, idxMap re-sorts them by candidateIds position.
      allowed.sort(
        (a, b) => (idxMap.get(a.id) ?? 1e9) - (idxMap.get(b.id) ?? 1e9),
      );

      page = allowed.slice(0, limit);
      // hasMore is true if either:
      //   (a) more candidate ids exist past our buffered window, OR
      //   (b) within the buffered window we still had >limit allowed rows
      //       (i.e. the page was capped by `limit`, not exhausted).
      hasMore = sliceEnd < ids.length || allowed.length > limit;
      nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;
    }
  } else {
    // Non-ranked path: q absent, OR q+sortBy (explicit sort wins). Uses
    // Prisma's native cursor + take + orderBy. Behavior unchanged from R42.
    const rows = await prisma.objectEntity.findMany({
      where,
      cursor,
      skip: cursor ? 1 : 0,
      take: limit + 1, // fetch one extra to detect hasMore
      orderBy,
      select: selectShape,
    });

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

    hasMore = allowed.length > limit;
    page = hasMore ? allowed.slice(0, limit) : allowed;
    nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;
  }

  // Normalize Decimal -> string + flatten nested includes for the client.
  const data: ObjectSummary[] = page.map((r) => {
    const masterAttId =
      r.revisions[0]?.versions[0]?.attachments[0]?.id ?? null;
    return {
      id: r.id,
      number: r.number,
      name: r.name,
      description: r.description,
      folderId: r.folderId,
      classId: r.classId,
      classCode: r.class.code,
      className: r.class.name,
      securityLevel: r.securityLevel,
      state: r.state,
      ownerId: r.ownerId,
      ownerName: r.owner.fullName,
      currentRevision: r.currentRevision,
      currentVersion: r.currentVersion.toString(),
      lockedById: r.lockedById,
      masterAttachmentId: masterAttId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      // R40 S-1 — null when no `q` was searched OR when the match was on
      // number/name/description only (trgm path). pdfSnippetById is
      // populated solely from the attachment-FTS query above.
      pdfSnippet: pdfSnippetById.get(r.id) ?? null,
      // R42 — null when no `q` was searched. Otherwise reflects whether
      // this object hit on meta (trgm) only, pdf body (FTS) only, or both.
      matchSource: matchSourceById.get(r.id) ?? null,
    };
  });

  return ok(data, { nextCursor, hasMore });
}

export const POST = withApi({ rateLimit: 'api' }, async (req: Request) => {
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
});

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

/**
 * Walk the Folder tree from `rootId` downward and return all reachable folder
 * ids (including the root). Used so a folder click filters descendants too.
 */
async function collectFolderSubtreeIds(rootId: string): Promise<string[]> {
  const all = await prisma.folder.findMany({
    select: { id: true, parentId: true },
  });
  const childrenByParent = new Map<string, string[]>();
  for (const f of all) {
    if (!f.parentId) continue;
    const arr = childrenByParent.get(f.parentId) ?? [];
    arr.push(f.id);
    childrenByParent.set(f.parentId, arr);
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    const kids = childrenByParent.get(id);
    if (kids) stack.push(...kids);
  }
  return out;
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
