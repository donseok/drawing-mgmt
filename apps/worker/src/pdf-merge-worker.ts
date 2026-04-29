/**
 * R-PDF-MERGE — BullMQ worker for the `pdf-merge` queue.
 *
 * Backlog P-2 As-Is parity. Consumes `PdfMergeJobPayload` jobs and produces
 * a single merged PDF in storage at `<aggregateJobId>/merged.pdf`. The web
 * route (POST /api/v1/objects/bulk-pdf-merge) creates the ConversionJob row
 * + pre-validates every selection before pushing here, so this worker only
 * has to handle bytes.
 *
 * Per-attachment processing:
 *   - PDF       : storage.get → buffer → tempfile → pdf-lib load
 *   - DXF       : storage.get → tempfile → generatePdfFromDxf(...)
 *   - DWG       : storage.get(`<id>/preview.dxf`) → tempfile → generatePdfFromDxf(...)
 *                 (the route guarantees this cache exists before enqueue)
 *   - JPG/PNG   : storage.get → buffer → fresh PDFDocument with embedJpg/Png
 *                 fitted onto a single A4 (or A3) page
 *
 * Stitching:
 *   PDFDocument.create() → for each per-attachment doc:
 *     `mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices())` →
 *     `mergedDoc.addPage(...)`. pdf-lib's copyPages handles font/resource
 *     dedupe so the merged file isn't a naive concat.
 *
 * Concurrency: 1 — bulk merge is CPU + memory heavy and we don't want it
 *              starving the per-attachment PDF print queue or DWG conversion.
 *
 * Per-attachment timeout: 30s. Bulk batches of 50 large CAD drawings
 *   could take meaningful time; we fail one row rather than hang the whole
 *   job. The failure is recorded in metadata.failures[] and the merge
 *   continues with the rest.
 *
 * Job-level timeout: BullMQ retry policy is `attempts: 1` (set on the web
 *   side via PDF_MERGE_JOB_OPTIONS), so a hung job will eventually be
 *   surfaced via the row's PROCESSING status — admins can manually flip
 *   FAILED. A future round can wire BullMQ's `lockDuration` if needed.
 *
 * License posture: pdf-lib (MIT) only. GPL/AGPL direct link 0. The
 * upstream LibreDWG conversion already produced `preview.dxf` via
 * subprocess; we only read the result via the storage abstraction.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis as IORedis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import { Prisma, ConversionStatus } from '@prisma/client';
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { PDFDocument, PageSizes } from 'pdf-lib';
import {
  PDF_MERGE_QUEUE_NAME,
  PdfMergeJobPayloadSchema,
  type PdfMergeJobPayload,
  type PdfMergeFailure,
  type PdfMergeResult,
} from '@drawing-mgmt/shared/conversion';
import { generatePdfFromDxf, type PdfCtb, type PdfPageSize } from './pdf.js';
import { getStorage, type Storage } from './storage.js';

// ─── tunables ───────────────────────────────────────────────────────────────

/**
 * Per-attachment processing budget. Past this, we record a failure and move
 * on rather than starve the rest of the merge.
 */
const PER_ATTACHMENT_TIMEOUT_MS = 30_000;

/**
 * Hard cap on the bytes loaded into memory per attachment (PDF/image). At
 * 50 attachments × 50 MB the worker would burn ~2.5 GB transiently — beyond
 * this we fail-fast instead. Bumping later is fine; we just want a safety
 * rail.
 */
const PER_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

// ─── helpers ────────────────────────────────────────────────────────────────

async function makeJobTempDir(jobId: string): Promise<string> {
  const dir = path.join(os.tmpdir(), `dm-pdf-merge-${jobId}-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/** Pump a NodeJS.ReadableStream into a Buffer with a max-byte guard. */
async function streamToBuffer(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf8')
        : Buffer.from(chunk as Uint8Array);
    total += buf.byteLength;
    if (total > maxBytes) {
      throw new Error(`첨부 크기가 ${maxBytes} bytes를 초과합니다.`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** Pipe a stream to a local file on disk (used for DXF inputs). */
async function pipeToFile(
  stream: NodeJS.ReadableStream,
  filePath: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(filePath);
    stream.pipe(ws);
    ws.on('finish', () => resolve());
    ws.on('error', reject);
    stream.on('error', reject);
  });
}

/** Cooperative timeout wrapper. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} 타임아웃 (${ms}ms 초과)`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Map page-size enum to pdf-lib points (matches apps/worker/src/pdf.ts). */
function pageSizePoints(size: PdfPageSize): [number, number] {
  // pdf-lib's PageSizes.A4/A3 are also `[w, h]` in points; using literals
  // here so the file doesn't depend on pdf-lib's internal enum shape.
  return size === 'A3' ? [842, 1191] : [595, 842];
}

// ─── per-attachment producers ───────────────────────────────────────────────

interface AttachmentPdfBytes {
  /** PDF bytes for this single attachment (1..N pages). */
  bytes: Uint8Array;
}

interface AttachmentRow {
  id: string;
  filename: string;
  mimeType: string;
  storagePath: string;
  virusScanStatus: string;
}

interface ProducerDeps {
  storage: Storage;
  tmpDir: string;
  ctb: PdfCtb;
  pageSize: PdfPageSize;
}

function classifyAttachment(att: AttachmentRow): 'pdf' | 'dxf' | 'dwg' | 'image' | null {
  const head = att.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = att.filename.toLowerCase().split('.').pop() ?? '';
  if (head === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    head === 'application/dxf' ||
    head === 'application/x-dxf' ||
    head === 'image/vnd.dxf' ||
    ext === 'dxf'
  ) {
    return 'dxf';
  }
  if (
    head === 'application/acad' ||
    head === 'image/vnd.dwg' ||
    head === 'image/x-dwg' ||
    head === 'application/x-dwg' ||
    ext === 'dwg'
  ) {
    return 'dwg';
  }
  if (head === 'image/jpeg' || head === 'image/png' || ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
    return 'image';
  }
  return null;
}

async function producePdfBytes(
  att: AttachmentRow,
  deps: ProducerDeps,
): Promise<AttachmentPdfBytes> {
  const kind = classifyAttachment(att);
  if (!kind) {
    throw new Error('지원하지 않는 파일 형식입니다.');
  }

  switch (kind) {
    case 'pdf': {
      // Source PDF — passthrough. We still buffer-and-load so the merger
      // can reuse pages without keeping the storage stream alive.
      const { stream } = await deps.storage.get(att.storagePath);
      const buf = await streamToBuffer(stream, PER_ATTACHMENT_MAX_BYTES);
      return { bytes: new Uint8Array(buf) };
    }
    case 'dxf': {
      const local = path.join(deps.tmpDir, `${att.id}.dxf`);
      const { stream } = await deps.storage.get(att.storagePath);
      await pipeToFile(stream, local);
      const result = await generatePdfFromDxf(local, {
        ctb: deps.ctb,
        pageSize: deps.pageSize,
      });
      if (result.entityCount === 0) {
        throw new Error(
          `DXF에서 그릴 수 있는 엔티티가 없습니다 (skipped: ${result.skippedKinds.join(', ') || 'none'}).`,
        );
      }
      return { bytes: new Uint8Array(result.pdf) };
    }
    case 'dwg': {
      // DWG path — we read the cached preview.dxf produced by the main
      // pipeline (LibreDWG/ODA subprocess). The web route guarantees this
      // file exists before enqueue, so a missing key here is an unexpected
      // race we surface as a per-row failure.
      const previewKey = `${att.id}/preview.dxf`;
      const exists = await deps.storage.exists(previewKey).catch(() => false);
      if (!exists) {
        throw new Error(
          'DXF 프리뷰 캐시가 없습니다 — 자료 상세에서 변환 완료 후 재시도해주세요.',
        );
      }
      const local = path.join(deps.tmpDir, `${att.id}.dxf`);
      const { stream } = await deps.storage.get(previewKey);
      await pipeToFile(stream, local);
      const result = await generatePdfFromDxf(local, {
        ctb: deps.ctb,
        pageSize: deps.pageSize,
      });
      if (result.entityCount === 0) {
        throw new Error(
          `DWG 변환 결과에서 그릴 수 있는 엔티티가 없습니다 (skipped: ${result.skippedKinds.join(', ') || 'none'}).`,
        );
      }
      return { bytes: new Uint8Array(result.pdf) };
    }
    case 'image': {
      // JPG/PNG → fresh PDFDocument with the image fitted on a single page.
      const { stream } = await deps.storage.get(att.storagePath);
      const buf = await streamToBuffer(stream, PER_ATTACHMENT_MAX_BYTES);
      const doc = await PDFDocument.create();
      doc.setTitle(`drawing-mgmt merge — ${att.filename}`);
      doc.setProducer('drawing-mgmt worker (pdf-lib)');
      const head = att.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
      const ext = att.filename.toLowerCase().split('.').pop() ?? '';
      const isJpg = head === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg';
      const img = isJpg ? await doc.embedJpg(buf) : await doc.embedPng(buf);
      const [pageW, pageH] = pageSizePoints(deps.pageSize);
      const page = doc.addPage([pageW, pageH]);
      // 20mm margin (matches the DXF mapper).
      const marginPt = 20 * 2.8346456693;
      const drawableW = pageW - marginPt * 2;
      const drawableH = pageH - marginPt * 2;
      const scale = Math.min(drawableW / img.width, drawableH / img.height);
      const renderW = img.width * scale;
      const renderH = img.height * scale;
      page.drawImage(img, {
        x: (pageW - renderW) / 2,
        y: (pageH - renderH) / 2,
        width: renderW,
        height: renderH,
      });
      const bytes = await doc.save();
      return { bytes };
    }
  }
}

// ─── core handler ───────────────────────────────────────────────────────────

interface ProcessDeps {
  prisma: PrismaClient;
  storage: Storage;
  log: pino.Logger;
}

/**
 * Run a single bulk-merge job. Exported for tests.
 */
export async function processPdfMergeJob(
  job: Job<PdfMergeJobPayload>,
  deps: ProcessDeps,
): Promise<PdfMergeResult> {
  const startedAt = Date.now();
  const payload = PdfMergeJobPayloadSchema.parse(job.data);
  const attemptNum = job.attemptsMade + 1;
  const { prisma, storage, log } = deps;

  log.info(
    {
      jobId: payload.aggregateJobId,
      total: payload.attachmentIds.length,
      ctb: payload.ctb,
      pageSize: payload.pageSize,
      attempt: attemptNum,
    },
    'pdf-merge start',
  );

  // Mark PROCESSING. We mirror the pdf-print + main worker pattern so the
  // status row reads consistently in admin UIs.
  await prisma.conversionJob
    .update({
      where: { id: payload.aggregateJobId },
      data: {
        status: ConversionStatus.PROCESSING,
        attempt: attemptNum,
        startedAt: new Date(),
        errorMessage: null,
      },
    })
    .catch((e) => {
      log.warn(
        { jobId: payload.aggregateJobId, err: (e as Error).message },
        'pdf-merge row update (PROCESSING) failed',
      );
    });

  // Load existing metadata so we don't clobber requestedBy/objectIds when
  // we write back the success/failure stats. The web route always writes
  // metadata, but missing-metadata is non-fatal here (failure mode falls
  // through to a default empty object).
  const existing = await prisma.conversionJob
    .findUnique({
      where: { id: payload.aggregateJobId },
      select: { metadata: true },
    })
    .catch(() => null);
  const baseMetadata = (existing?.metadata as Record<string, unknown> | null) ?? {};

  // We need attachment rows to know storagePath/mimeType per id. One bulk
  // query keeps the per-row producer hot path free of round-trips.
  const attachments = await prisma.attachment.findMany({
    where: { id: { in: payload.attachmentIds } },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      storagePath: true,
      virusScanStatus: true,
      version: {
        select: {
          revision: { select: { object: { select: { id: true } } } },
        },
      },
    },
  });
  const attById = new Map(attachments.map((a) => [a.id, a] as const));

  // Map attachmentId → objectId for failure reporting (FE shows the object
  // id, not the attachment id).
  const objectIdByAttachmentId = new Map<string, string>();
  for (const a of attachments) {
    const oid = a.version?.revision?.object?.id;
    if (oid) objectIdByAttachmentId.set(a.id, oid);
  }

  const failures: PdfMergeFailure[] = [];
  /** Successful per-attachment PDF bytes, in selection order. */
  const successBytes: Uint8Array[] = [];

  const tmpDir = await makeJobTempDir(payload.aggregateJobId);

  try {
    for (const attachmentId of payload.attachmentIds) {
      const att = attById.get(attachmentId);
      const objectId = objectIdByAttachmentId.get(attachmentId) ?? attachmentId;

      if (!att) {
        failures.push({
          objectId,
          reason: '첨부 정보를 찾을 수 없습니다.',
        });
        continue;
      }

      // Race-safety: route already gated INFECTED, but the scan row could
      // flip between request and worker pickup. Bail out to keep merged
      // PDFs away from infected payloads.
      if (att.virusScanStatus === 'INFECTED') {
        failures.push({
          objectId,
          reason: '감염 의심 첨부입니다.',
        });
        continue;
      }

      try {
        const { bytes } = await withTimeout(
          producePdfBytes(att, {
            storage,
            tmpDir,
            ctb: payload.ctb,
            pageSize: payload.pageSize,
          }),
          PER_ATTACHMENT_TIMEOUT_MS,
          `첨부 ${att.filename} 처리`,
        );
        successBytes.push(bytes);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        log.warn(
          { jobId: payload.aggregateJobId, attachmentId, err: reason },
          'pdf-merge: per-attachment failed',
        );
        failures.push({ objectId, reason });
      }
    }

    // Stitch successful PDFs.
    const totalCount = payload.attachmentIds.length;
    const successCount = successBytes.length;
    const failureCount = failures.length;

    let pdfStorageKey: string | undefined;
    if (successCount > 0) {
      const merged = await PDFDocument.create();
      merged.setTitle('drawing-mgmt merged drawings');
      merged.setProducer('drawing-mgmt worker (pdf-lib)');
      for (const bytes of successBytes) {
        const src = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(src, src.getPageIndices());
        for (const page of pages) {
          merged.addPage(page);
        }
      }
      const mergedBytes = Buffer.from(await merged.save());
      pdfStorageKey = `${payload.aggregateJobId}/merged.pdf`;
      await storage.put(pdfStorageKey, mergedBytes, {
        contentType: 'application/pdf',
      });
      log.info(
        {
          jobId: payload.aggregateJobId,
          pdfStorageKey,
          totalCount,
          successCount,
          failureCount,
          bytes: mergedBytes.byteLength,
        },
        'pdf-merge stitched',
      );
    }

    // Persist results — partial success is DONE, all-fail is FAILED.
    const allFailed = successCount === 0;
    const finalMetadata = {
      ...baseMetadata,
      kind: 'PDF_MERGE',
      totalCount,
      successCount,
      failureCount,
      failures,
    };

    await prisma.conversionJob
      .update({
        where: { id: payload.aggregateJobId },
        data: {
          status: allFailed
            ? ConversionStatus.FAILED
            : ConversionStatus.DONE,
          finishedAt: new Date(),
          errorMessage: allFailed
            ? '모든 첨부의 PDF 생성에 실패했습니다.'
            : null,
          pdfPath: pdfStorageKey ?? null,
          metadata: finalMetadata as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((e) => {
        log.warn(
          { jobId: payload.aggregateJobId, err: (e as Error).message },
          'pdf-merge row update (DONE/FAILED) failed',
        );
      });

    const result: PdfMergeResult = {
      jobId: payload.aggregateJobId,
      totalCount,
      successCount,
      failureCount,
      failures,
      pdfPath: pdfStorageKey,
      durationMs: Date.now() - startedAt,
    };
    log.info(result, allFailed ? 'pdf-merge failed (all)' : 'pdf-merge done');
    return result;
  } catch (err) {
    // Catastrophic failure (PDFDocument.create throw, storage.put crash,
    // …). Mark the row FAILED with the underlying error so admins can
    // diagnose. We don't attempt a partial save here — the merged PDF
    // either exists end-to-end or not at all.
    const errMessage = err instanceof Error ? err.message : String(err);
    log.error(
      { jobId: payload.aggregateJobId, err: errMessage },
      'pdf-merge unexpected failure',
    );

    await prisma.conversionJob
      .update({
        where: { id: payload.aggregateJobId },
        data: {
          status: ConversionStatus.FAILED,
          errorMessage: errMessage,
          finishedAt: new Date(),
          metadata: {
            ...baseMetadata,
            kind: 'PDF_MERGE',
            totalCount: payload.attachmentIds.length,
            successCount: 0,
            failureCount: payload.attachmentIds.length,
            failures,
          } as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((updateErr) => {
        log.warn(
          {
            jobId: payload.aggregateJobId,
            err: (updateErr as Error).message,
          },
          'pdf-merge row update (catastrophic FAILED) failed',
        );
      });

    throw err;
  } finally {
    await cleanupTempDir(tmpDir);
  }
}

// ─── worker bootstrap ───────────────────────────────────────────────────────

export interface PdfMergeWorkerHandle {
  worker: Worker<PdfMergeJobPayload, PdfMergeResult>;
  close: () => Promise<void>;
}

interface StartDeps {
  connection: IORedis;
  prisma: PrismaClient;
  log: pino.Logger;
  /** Inject for tests; defaults to the storage singleton. */
  storage?: Storage;
}

export function startPdfMergeWorker(deps: StartDeps): PdfMergeWorkerHandle {
  const { connection, prisma, log } = deps;
  const storage = deps.storage ?? getStorage();

  const worker = new Worker<PdfMergeJobPayload, PdfMergeResult>(
    PDF_MERGE_QUEUE_NAME,
    (job) => processPdfMergeJob(job, { prisma, storage, log }),
    {
      connection,
      // Sequential — bulk merges are heavy and we don't want to compete with
      // single-attachment print jobs for CPU/memory.
      concurrency: Number(process.env.PDF_MERGE_CONCURRENCY ?? 1),
    },
  );

  worker.on('completed', (_job, result) => {
    log.info(
      {
        jobId: result.jobId,
        totalCount: result.totalCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
        durationMs: result.durationMs,
      },
      'pdf-merge job completed',
    );
  });
  worker.on('failed', (job, err) => {
    log.error(
      { jobId: job?.data?.aggregateJobId, err: err.message },
      'pdf-merge failed',
    );
  });

  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}

// `PageSizes` is referenced indirectly to keep pdf-lib imports tree-shake-
// friendly when the worker is built for prod; the value is unused here but
// importing it pulls in the page-size constants the caller may want for
// future tuning.
void PageSizes;
