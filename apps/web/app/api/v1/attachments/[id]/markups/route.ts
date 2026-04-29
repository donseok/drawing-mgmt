// GET  /api/v1/attachments/[id]/markups  → list (mine + shared)
// POST /api/v1/attachments/[id]/markups  → create
//
// R-MARKUP / V-6 — Persist measurement markups so the viewer's annotation
// state survives a refresh. Two pieces of behaviour are unique to this
// route:
//
//   1. We split the response into `mine` (ownerId === user.id) and
//      `shared` (isShared === true && ownerId !== user.id) so the FE can
//      render two stacks without a second query. Admins get the same
//      split keyed off their own user.id — the privilege difference
//      shows up in PATCH/DELETE, not the list (which by definition
//      already returns everything an admin would want to see).
//
//   2. POST is rate-limited and CSRF-checked through `withApi`. Beyond
//      the zod cap (≤500 measurements, ≤200 points each), we also
//      enforce a serialized-size guard of 256KB so a malicious caller
//      can't construct a payload that escapes both caps via deeply
//      nested objects. If the JSON is over the limit we surface a
//      Korean message via E_VALIDATION rather than blowing up at the
//      Postgres JSONB layer.

import type { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { requireAttachmentView } from '@/lib/attachment-auth';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import {
  CreateMarkupBodySchema,
  MarkupPayloadSchema,
  type MarkupPayload,
  type MarkupRow,
  type MarkupDetail,
  type MarkupListResponse,
} from '@drawing-mgmt/shared/markup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Hard cap on the JSON-serialized markup payload. The zod schema already
 * caps measurement count and points-per-measurement, but `unitLabel`
 * inside each Measurement (and any future text fields) could still be
 * pushed up to a few hundred KB without tripping the row caps. 256KB is
 * comfortably above any realistic annotation set and well below
 * Postgres' practical JSONB sweet spot.
 */
const PAYLOAD_BYTE_LIMIT = 256 * 1024;

// ── GET ──────────────────────────────────────────────────────────────────

export async function GET(
  req: Request,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAttachmentView(req, ctx.params.id);
  if (gate instanceof Response) return gate;
  const { user, attachment } = gate;

  const rows = await prisma.markup.findMany({
    where: {
      attachmentId: attachment.id,
      // Mine OR explicitly shared. Admins see both because (a) "mine"
      // already includes their own rows, (b) "shared" already includes
      // every team-shared row regardless of who they belong to. Private
      // markups owned by *other* users stay hidden — admins manage by
      // PATCH/DELETE on a known id, not by browsing strangers' drafts.
      OR: [{ ownerId: user.id }, { isShared: true }],
    },
    include: { owner: { select: { id: true, fullName: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  const mine: MarkupRow[] = [];
  const shared: MarkupRow[] = [];
  for (const r of rows) {
    const row = toMarkupRow(r);
    if (row.ownerId === user.id) {
      mine.push(row);
    } else if (r.isShared) {
      // Defensive: the where-clause already excludes this branch for
      // non-owners, but spelling it out keeps intent obvious.
      shared.push(row);
    }
  }

  const body: MarkupListResponse = { attachmentId: attachment.id, mine, shared };
  return ok(body);
}

// ── POST ─────────────────────────────────────────────────────────────────

export const POST = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
    const gate = await requireAttachmentView(req, params.id);
    if (gate instanceof Response) return gate;
    const { user, attachment, object } = gate;

    const parsed = await readCreateBody(req);
    if (parsed instanceof Response) return parsed;
    const { name, isShared, payload } = parsed;

    // 256KB serialized guard. Computed once after zod parse — at this
    // point the shape is known to fit the row/point caps so the JSON
    // string length is the only remaining lever.
    const sizeCheck = enforcePayloadSize(payload);
    if (sizeCheck) return sizeCheck;

    const row = await prisma.markup.create({
      data: {
        attachmentId: attachment.id,
        ownerId: user.id,
        name,
        isShared,
        // Cast through Prisma's JSON helper — zod validated the structure,
        // so we trust the shape into JSONB without a second pass.
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      include: { owner: { select: { id: true, fullName: true } } },
    });

    const meta = extractRequestMeta(req);
    await logActivity({
      userId: user.id,
      action: 'MARKUP_SAVE',
      objectId: object.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        attachmentId: attachment.id,
        markupId: row.id,
        name,
        isShared,
        mode: payload.mode,
        measurementCount: payload.measurements.length,
      },
    });

    const body: MarkupDetail = { ...toMarkupRow(row), payload };
    return ok(body);
  },
);

// ── helpers ──────────────────────────────────────────────────────────────

interface MarkupWithOwner {
  id: string;
  attachmentId: string;
  ownerId: string;
  name: string;
  isShared: boolean;
  payload: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  owner: { id: string; fullName: string };
}

/**
 * Project a Prisma row (with `owner` included) into the wire shape.
 * `payload` is JSONB so we read the count/mode defensively — a row that
 * predates a future schema version still surfaces as an empty markup
 * rather than crashing the list endpoint.
 */
function toMarkupRow(r: MarkupWithOwner): MarkupRow {
  const payload = r.payload as Partial<MarkupPayload> | null;
  const measurements = Array.isArray(payload?.measurements)
    ? (payload!.measurements as unknown[])
    : [];
  const mode: MarkupRow['mode'] = payload?.mode === 'dxf' ? 'dxf' : 'pdf';
  return {
    id: r.id,
    attachmentId: r.attachmentId,
    ownerId: r.ownerId,
    ownerName: r.owner.fullName,
    name: r.name,
    isShared: r.isShared,
    measurementCount: measurements.length,
    mode,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function readCreateBody(
  req: Request,
): Promise<
  | { name: string; isShared: boolean; payload: MarkupPayload }
  | NextResponse
> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '요청 본문이 올바른 JSON이 아닙니다.');
  }
  const parsed = CreateMarkupBodySchema.safeParse(raw);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      '마크업 데이터가 올바르지 않습니다.',
      undefined,
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

function enforcePayloadSize(payload: MarkupPayload): NextResponse | null {
  // Re-run the schema parse once for paranoia (this is the single source
  // for what gets stored) and then count bytes of the stringified value.
  const safe = MarkupPayloadSchema.parse(payload);
  const size = Buffer.byteLength(JSON.stringify(safe), 'utf8');
  if (size > PAYLOAD_BYTE_LIMIT) {
    return error(
      ErrorCode.E_VALIDATION,
      '마크업이 너무 큽니다 (256KB 초과). 측정 수를 줄여주세요.',
    );
  }
  return null;
}

/**
 * Re-export so the PATCH route in `markups/[markupId]/route.ts` and the
 * unit test next to this file can share the same byte-counter.
 */
export const __test = { PAYLOAD_BYTE_LIMIT, enforcePayloadSize };
