// POST /api/v1/objects/bulk-pdf-merge
//
// R-PDF-MERGE — backlog P-2 As-Is parity. Take a multi-select of search-
// result rows (1..50) and produce a single merged PDF for download.
//
// Flow:
//   1. Auth + parse + bulk-row pre-validation:
//        - row exists
//        - PRINT permission (admin bypass)
//        - master attachment exists
//        - virus scan != INFECTED
//        - mimeType on the merge whitelist
//        - DWG → must already have `<attachmentId>/preview.dxf` cached
//      ANY single row failing → 400 envelope with `details.failures[]`
//      (list every failing row at once so the user fixes one selection).
//   2. ConversionJob row insert with `metadata.kind='PDF_MERGE'` +
//      `metadata.requestedBy` (used by status / merged.pdf gate). Anchor
//      `attachmentId` is the first row's master so the FK constraint is
//      satisfied without schema change.
//   3. Push payload to the dedicated `pdf-merge` BullMQ queue.
//   4. ActivityLog `OBJECT_PRINT` per row with `kind:'PDF_MERGE_REQUEST'`
//      so admin audit can correlate the bulk action across selections.
//   5. Respond `{ jobId, status:'QUEUED', objectCount }`.
//
// FE polls GET /api/v1/print-jobs/{jobId}/status until DONE/FAILED, then
// hits GET /api/v1/print-jobs/{jobId}/merged.pdf for the bytes.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  toPermissionUser,
  loadFolderPermissions,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import type { ApiErrorCode } from '@/lib/api-errors';
import { extractRequestMeta, logActivityBatch } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';
import { getStorage } from '@/lib/storage';
import {
  PDF_MERGE_JOB_OPTIONS,
  getPdfMergeQueue,
} from '@/lib/pdf-merge-queue';
import type { PdfMergeJobPayload } from '@drawing-mgmt/shared/conversion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mirrors the contract §4 whitelist. Phase-2 image kinds (TIFF/BMP/GIF) are
// rejected here so the worker never has to deal with formats pdf-lib can't
// embed natively. Real DWG/DXF detection also falls back on the filename
// extension because some browsers/upload paths leave mimeType as
// application/octet-stream — the worker `mimeType` branch handles either.
const PDF_MERGE_OK_MIMES: ReadonlySet<string> = new Set<string>([
  // PDFs — passthrough
  'application/pdf',
  // DXF — text + variants
  'application/dxf',
  'application/x-dxf',
  'image/vnd.dxf',
  // DWG — multiple historical claim spellings
  'application/acad',
  'image/vnd.dwg',
  'image/x-dwg',
  'application/x-dwg',
  // Raster — pdf-lib embedJpg / embedPng
  'image/jpeg',
  'image/png',
]);

/** Filename-extension fallback when mimeType is octet-stream / missing. */
function classifyByExt(filename: string): 'pdf' | 'dxf' | 'dwg' | 'image' | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'dxf') return 'dxf';
  if (ext === 'dwg') return 'dwg';
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return 'image';
  return null;
}

function isMergeable(mimeType: string, filename: string): boolean {
  const head = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (PDF_MERGE_OK_MIMES.has(head)) return true;
  // Some browsers send octet-stream for CAD uploads; fall through to ext.
  if (head === 'application/octet-stream' || head === '') {
    return classifyByExt(filename) !== null;
  }
  return false;
}

function isDwg(mimeType: string, filename: string): boolean {
  const head = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (
    head === 'application/acad' ||
    head === 'image/vnd.dwg' ||
    head === 'image/x-dwg' ||
    head === 'application/x-dwg'
  ) {
    return true;
  }
  if (head === 'application/octet-stream' || head === '') {
    return classifyByExt(filename) === 'dwg';
  }
  return false;
}

const MAX_BATCH = 50;

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(MAX_BATCH),
  ctb: z.enum(['mono', 'color-a3']).default('mono'),
  pageSize: z.enum(['A4', 'A3']).default('A4'),
});

interface RowFailure {
  id: string;
  code: ApiErrorCode | 'E_INFECTED' | 'E_UNSUPPORTED' | 'E_DXF_CACHE_MISSING';
  message: string;
}

async function handlePost(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  // 1) Body parse — defaults applied so the FE can omit ctb/pageSize.
  let payload: z.infer<typeof bodySchema>;
  try {
    const raw = await req.json().catch(() => ({}));
    payload = bodySchema.parse(raw ?? {});
  } catch (err) {
    return error(
      ErrorCode.E_VALIDATION,
      '선택 자료는 1..50건이어야 합니다.',
      undefined,
      err instanceof z.ZodError ? err.flatten() : undefined,
    );
  }

  const uniqueIds = Array.from(new Set(payload.ids));

  // 2) Bulk fetch objects + their master attachment so we can validate
  //    mime/scan-status without N+1 queries.
  //
  //    `masterAttachmentId` isn't a column on ObjectEntity — it's computed
  //    from the latest revision's latest version's attachment with
  //    `isMaster=true`. Same shape used by GET /api/v1/objects (route.ts).
  const objects = await prisma.objectEntity.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      folderId: true,
      ownerId: true,
      securityLevel: true,
      number: true,
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
                select: {
                  id: true,
                  filename: true,
                  mimeType: true,
                  storagePath: true,
                  virusScanStatus: true,
                  virusScanSig: true,
                },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  /** Per-row resolved master attachment (null when none). */
  type ResolvedRow = {
    id: string;
    folderId: string;
    ownerId: string;
    securityLevel: number;
    number: string;
    masterAttachment:
      | {
          id: string;
          filename: string;
          mimeType: string;
          storagePath: string;
          virusScanStatus: string;
          virusScanSig: string | null;
        }
      | null;
  };
  const byId = new Map<string, ResolvedRow>();
  for (const o of objects) {
    const att = o.revisions[0]?.versions[0]?.attachments[0] ?? null;
    byId.set(o.id, {
      id: o.id,
      folderId: o.folderId,
      ownerId: o.ownerId,
      securityLevel: o.securityLevel,
      number: o.number,
      masterAttachment: att,
    });
  }

  // 3) Folder permission table for the PRINT decision (admin bypass inside
  //    canAccess).
  const folderIds = Array.from(new Set(Array.from(byId.values()).map((o) => o.folderId)));
  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);
  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions(folderIds),
  ]);

  // 4) Storage probe — needed only for DWG rows (preview.dxf cache check).
  //    We probe in bulk via Promise.all so a worst-case 50-row mixed batch
  //    still finishes pre-validation in a single round-trip flight.
  const storage = getStorage();

  // Per-row checks, accumulating every failure.
  const failures: RowFailure[] = [];
  const dwgProbeIndex: { id: string; attachmentId: string }[] = [];

  for (const id of uniqueIds) {
    const obj = byId.get(id);
    if (!obj) {
      failures.push({
        id,
        code: ErrorCode.E_NOT_FOUND,
        message: '대상 자료를 찾을 수 없습니다.',
      });
      continue;
    }

    const decision = canAccess(pUser, obj, perms, 'PRINT');
    if (!decision.allowed) {
      failures.push({
        id,
        code: ErrorCode.E_FORBIDDEN,
        message: decision.reason ?? 'PRINT 권한이 없습니다.',
      });
      continue;
    }

    const att = obj.masterAttachment;
    if (!att) {
      failures.push({
        id,
        code: ErrorCode.E_NOT_FOUND,
        message: '마스터 첨부가 없습니다.',
      });
      continue;
    }

    if (att.virusScanStatus === 'INFECTED') {
      failures.push({
        id,
        code: 'E_INFECTED',
        message: `감염 의심 첨부입니다 (${att.virusScanSig ?? '시그니처 미상'}).`,
      });
      continue;
    }

    if (!isMergeable(att.mimeType, att.filename)) {
      failures.push({
        id,
        code: 'E_UNSUPPORTED',
        message: '지원하지 않는 파일 형식입니다.',
      });
      continue;
    }

    if (isDwg(att.mimeType, att.filename)) {
      dwgProbeIndex.push({ id, attachmentId: att.id });
    }
  }

  // 5) DWG cache probe in parallel — mark missing-preview rows as failures.
  if (dwgProbeIndex.length > 0) {
    const probes = await Promise.all(
      dwgProbeIndex.map(async (p) => {
        const key = `${p.attachmentId}/preview.dxf`;
        const exists = await storage.exists(key).catch(() => false);
        return { p, exists };
      }),
    );
    for (const { p, exists } of probes) {
      if (!exists) {
        failures.push({
          id: p.id,
          code: 'E_DXF_CACHE_MISSING',
          message:
            'DXF 프리뷰 캐시가 없습니다 — 자료 상세 진입 후 변환 완료를 기다린 뒤 다시 시도해주세요.',
        });
      }
    }
  }

  if (failures.length > 0) {
    return error(
      ErrorCode.E_VALIDATION,
      '선택 자료 중 일부에 PDF 병합이 불가합니다.',
      undefined,
      { failures },
    );
  }

  // All rows pass — assemble the final ordered attachmentIds[] preserving
  // request order (uniqueIds order). The first row's master is the anchor
  // attachmentId on the ConversionJob row.
  const orderedAttachmentIds: string[] = [];
  for (const id of uniqueIds) {
    const obj = byId.get(id);
    if (!obj?.masterAttachment) continue;
    orderedAttachmentIds.push(obj.masterAttachment.id);
  }
  const anchorAttachmentId = orderedAttachmentIds[0];
  if (!anchorAttachmentId) {
    // Defensive — shouldn't happen because failures[] guards above.
    return error(ErrorCode.E_VALIDATION, '병합할 첨부가 없습니다.');
  }

  // 6) Create the ConversionJob row + push BullMQ job.
  let jobRowId: string | undefined;
  try {
    const meta = {
      kind: 'PDF_MERGE' as const,
      ctb: payload.ctb,
      pageSize: payload.pageSize,
      objectIds: uniqueIds,
      attachmentIds: orderedAttachmentIds,
      requestedBy: user.id,
      totalCount: orderedAttachmentIds.length,
    };

    const row = await prisma.conversionJob.create({
      data: {
        attachmentId: anchorAttachmentId,
        status: 'PENDING',
        attempt: 0,
        metadata: meta as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    jobRowId = row.id;

    const jobPayload: PdfMergeJobPayload = {
      aggregateJobId: row.id,
      attachmentIds: orderedAttachmentIds,
      ctb: payload.ctb,
      pageSize: payload.pageSize,
    };

    const queue = getPdfMergeQueue();
    await queue.add('merge', jobPayload, {
      ...PDF_MERGE_JOB_OPTIONS,
      jobId: row.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jobRowId) {
      try {
        await prisma.conversionJob.update({
          where: { id: jobRowId },
          data: {
            status: 'FAILED',
            errorMessage: `enqueue failed: ${message}`,
            finishedAt: new Date(),
          },
        });
      } catch {
        /* secondary failure — ignore */
      }
    }
    return error(
      ErrorCode.E_INTERNAL,
      'PDF 병합 작업 등록에 실패했습니다: ' + message,
    );
  }

  // 7) Audit log per row (kind: PDF_MERGE_REQUEST). Single createMany so the
  //    response doesn't pay N round-trips on a 50-row click.
  const reqMeta = extractRequestMeta(req);
  await logActivityBatch(
    uniqueIds.map((id) => ({
      userId: user.id,
      action: 'OBJECT_PRINT',
      objectId: id,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: {
        jobId: jobRowId,
        kind: 'PDF_MERGE_REQUEST',
        ctb: payload.ctb,
        pageSize: payload.pageSize,
        bulk: true,
        objectCount: uniqueIds.length,
      },
    })),
  );

  return ok({
    jobId: jobRowId,
    status: 'QUEUED' as const,
    objectCount: orderedAttachmentIds.length,
  });
}

export const POST = withApi({ rateLimit: 'api' }, handlePost);
