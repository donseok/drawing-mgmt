// PATCH  /api/v1/markups/[markupId]  → rename / toggle share / replace payload
// DELETE /api/v1/markups/[markupId]  → remove
//
// R-MARKUP / V-6 — All editing/deletion happens by markup id (not by
// attachment + name). The route loads the markup, hops to its parent
// attachment for the standard VIEW + virus-scan gate, then enforces
// authorship: owner OR admin/super_admin can mutate. Anyone else with
// VIEW gets E_FORBIDDEN — they can see a shared markup but they can't
// take it over.
//
// Why split this from the list endpoint:
//   - The list lives under `/api/v1/attachments/[id]/markups` because
//     it's per-attachment. PATCH/DELETE only need the markup id, and a
//     URL like `/attachments/X/markups/Y` would force the FE to hold
//     onto X across page transitions even when it doesn't need it.
//   - Keeping these handlers small (single-row read + auth check) keeps
//     the cyclomatic complexity in the list route's payload validation
//     where it belongs.

import type { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { requireAttachmentView } from '@/lib/attachment-auth';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import {
  UpdateMarkupBodySchema,
  MarkupPayloadSchema,
  type MarkupDetail,
  type MarkupPayload,
  type MarkupRow,
} from '@drawing-mgmt/shared/markup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAYLOAD_BYTE_LIMIT = 256 * 1024;

// ── PATCH ────────────────────────────────────────────────────────────────

export const PATCH = withApi<{ params: { markupId: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
    const loaded = await loadAndAuthorize(req, params.markupId);
    if (loaded instanceof Response) return loaded;
    const { user, markup, attachmentId, objectId } = loaded;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return error(ErrorCode.E_VALIDATION, '요청 본문이 올바른 JSON이 아닙니다.');
    }
    const parsed = UpdateMarkupBodySchema.safeParse(raw);
    if (!parsed.success) {
      return error(
        ErrorCode.E_VALIDATION,
        '마크업 데이터가 올바르지 않습니다.',
        undefined,
        parsed.error.flatten(),
      );
    }
    const body = parsed.data;

    // Reject "no-op" updates so callers don't waste a row write + log
    // entry. zod's all-optional shape happily accepts `{}`.
    if (
      body.name === undefined &&
      body.isShared === undefined &&
      body.payload === undefined
    ) {
      return error(
        ErrorCode.E_VALIDATION,
        '변경할 항목이 없습니다 (name, isShared, payload 중 하나 이상 필요).',
      );
    }

    if (body.payload) {
      const sizeCheck = enforcePayloadSize(body.payload);
      if (sizeCheck) return sizeCheck;
    }

    // Build update fields explicitly so we never accidentally null out
    // a column the caller didn't touch. `payload` goes through
    // Prisma.InputJsonValue cast — zod already validated the shape.
    const data: Prisma.MarkupUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.isShared !== undefined) data.isShared = body.isShared;
    if (body.payload !== undefined) {
      data.payload = body.payload as unknown as Prisma.InputJsonValue;
    }

    const row = await prisma.markup.update({
      where: { id: markup.id },
      data,
      include: { owner: { select: { id: true, fullName: true } } },
    });

    const meta = extractRequestMeta(req);
    await logActivity({
      userId: user.id,
      action: 'MARKUP_UPDATE',
      objectId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        attachmentId,
        markupId: markup.id,
        // Surface only the changed keys so the audit row diff is easy
        // to scan after the fact.
        changes: {
          name: body.name !== undefined,
          isShared: body.isShared !== undefined,
          payload: body.payload !== undefined,
        },
        ...(body.isShared !== undefined ? { isShared: body.isShared } : {}),
      },
    });

    const detailPayload = (row.payload as unknown as MarkupPayload) ?? null;
    if (!detailPayload) {
      // Defensive — schema column is NOT NULL so this should never fire.
      return error(ErrorCode.E_INTERNAL, '마크업 데이터가 손상되었습니다.');
    }
    const detail: MarkupDetail = {
      ...rowProjection(row),
      payload: detailPayload,
    };
    return ok(detail);
  },
);

// ── DELETE ───────────────────────────────────────────────────────────────

export const DELETE = withApi<{ params: { markupId: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
    const loaded = await loadAndAuthorize(req, params.markupId);
    if (loaded instanceof Response) return loaded;
    const { user, markup, attachmentId, objectId } = loaded;

    await prisma.markup.delete({ where: { id: markup.id } });

    const meta = extractRequestMeta(req);
    await logActivity({
      userId: user.id,
      action: 'MARKUP_DELETE',
      objectId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        attachmentId,
        markupId: markup.id,
        name: markup.name,
        wasShared: markup.isShared,
      },
    });

    return ok({ deleted: true });
  },
);

// ── helpers ──────────────────────────────────────────────────────────────

interface LoadedMarkup {
  user: { id: string; role: string };
  markup: {
    id: string;
    ownerId: string;
    name: string;
    isShared: boolean;
  };
  attachmentId: string;
  /** ObjectEntity id for ActivityLog linkage. */
  objectId: string;
}

/**
 * Resolve a markup id into a row + attached parent + the authorisation
 * decision that PATCH and DELETE share. Returns either the loaded
 * context or a NextResponse the caller passes straight through.
 */
async function loadAndAuthorize(
  req: Request,
  markupId: string,
): Promise<LoadedMarkup | NextResponse> {
  // Quick path-shape sanity. Prisma would raise on an empty id anyway,
  // but spelling it out keeps the 404 envelope consistent with the
  // rest of the API.
  if (!markupId || !/^[A-Za-z0-9_\-]+$/.test(markupId)) {
    return error(ErrorCode.E_NOT_FOUND);
  }

  const markup = await prisma.markup.findUnique({
    where: { id: markupId },
    select: {
      id: true,
      ownerId: true,
      name: true,
      isShared: true,
      attachmentId: true,
    },
  });
  if (!markup) return error(ErrorCode.E_NOT_FOUND);

  // VIEW gate on the parent attachment — runs the same auth + virus-scan
  // checks as the list endpoint and bounces unauthenticated requests
  // before we even get to the authorship check below.
  const gate = await requireAttachmentView(req, markup.attachmentId);
  if (gate instanceof Response) return gate;
  const { user, object } = gate;

  // Authorship — owner OR admin/super_admin can mutate. Everyone else
  // with VIEW can read shared markups via the list endpoint, but
  // editing/deletion stays restricted.
  const isOwner = markup.ownerId === user.id;
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  if (!isOwner && !isAdmin) {
    return error(
      ErrorCode.E_FORBIDDEN,
      '본인이 만든 마크업만 수정/삭제할 수 있습니다.',
    );
  }

  return {
    user: { id: user.id, role: user.role },
    markup: {
      id: markup.id,
      ownerId: markup.ownerId,
      name: markup.name,
      isShared: markup.isShared,
    },
    attachmentId: markup.attachmentId,
    objectId: object.id,
  };
}

interface MarkupRowWithOwner {
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

function rowProjection(r: MarkupRowWithOwner): MarkupRow {
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

function enforcePayloadSize(payload: MarkupPayload): NextResponse | null {
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
