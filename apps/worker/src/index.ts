// DWG conversion worker entry.
//
// Two BullMQ Workers run in this process:
//   1. `dwg-conversion` (CONVERSION_QUEUE_NAME) — DWG → DXF + thumbnail.
//   2. `pdf-print` (PDF_PRINT_QUEUE_NAME, R31 P-1) — DXF → PDF for printing.
//
// Both share the `ConversionJob` row for status (PENDING → PROCESSING →
// DONE/FAILED) and the same Redis/Prisma singletons.
//
// R28 V-INF-4 — adds ConversionJob row state tracking, BullMQ retry policy,
// and a LibreDWG `dwg2dxf` subprocess fallback when ODA fails. LibreDWG is
// GPL → subprocess only, never imported as a library.
//
// R31 P-1 — adds the `pdf-print` queue + worker. PDF rendering uses pdf-lib
// (MIT) over our own DXF mapper — no GPL/AGPL deps. See `./pdf.ts`.

import { Worker, Queue, type Job } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import pino from 'pino';
import { createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient, ConversionStatus } from '@prisma/client';
import {
  CONVERSION_QUEUE_NAME,
  ConversionJobPayloadSchema,
  PDF_EXTRACT_QUEUE_NAME,
  PDF_PRINT_QUEUE_NAME,
  PdfPrintJobPayloadSchema,
  type ConversionJobPayload,
  type ConversionResult,
  type PdfExtractJobPayload,
  type PdfPrintJobPayload,
  type PdfPrintResult,
} from '@drawing-mgmt/shared/conversion';
import { dwgToDxf } from './oda.js';
import { dwgToDxfLibre, LibreDwgUnavailableError } from './libredwg.js';
import { generateThumbnail } from './thumbnail.js';
import { generatePdfFromDxf } from './pdf.js';
import { startBackupWorker } from './backup-worker.js';
import { startMailWorker } from './mail-worker.js';
import { startScanWorker } from './scan-worker.js';
import { startSmsWorker } from './sms-worker.js';
import { startKakaoWorker } from './kakao-worker.js';
import { startPdfExtractWorker } from './pdf-extract-worker.js';
import { startPdfMergeWorker } from './pdf-merge-worker.js';
import { startSecurityAuditWorker } from './security-audit-worker.js';
import { PDF_MERGE_QUEUE_NAME } from '@drawing-mgmt/shared/conversion';
import { getStorage, type Storage } from './storage.js';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const ODA_CONVERTER_PATH =
  process.env.ODA_CONVERTER_PATH ??
  'C:/Program Files/ODA/ODAFileConverter 27.1.0/ODAFileConverter.exe';
const LIBREDWG_BIN = process.env.LIBREDWG_DWG2DXF_PATH ?? 'dwg2dxf';

// FILE_STORAGE_ROOT is no longer referenced directly; the storage abstraction
// (apps/worker/src/storage.ts) reads it internally for the Local driver.

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const prisma = new PrismaClient();
const storage: Storage = getStorage();

// ─────────────────────────────────────────────────────────────────────────
// R34 V-INF-1 — Storage helpers.
//
// Conversion artifacts live in storage now (Local or S3) instead of being
// written directly to FILE_STORAGE_ROOT. The worker keeps using a temp dir
// for subprocess inputs/outputs (ODA / LibreDWG / pdf-lib all need real
// files), then promotes the result via `storage.put`.
//
// Storage key layout (mirrors the contract §5):
//   <attachmentId>/source.<ext>          (uploaded by web)
//   <attachmentId>/preview.dxf           (DWG → DXF artifact)
//   <attachmentId>/thumbnail.png         (256×256 preview)
//   <attachmentId>/print-<ctb>-<size>.pdf (R31 PDF render)
//
// Backward compat: legacy ConversionJob rows store absolute paths in
// dxfPath/thumbnailPath. Those rows are still resolvable by the web layer
// (which falls back to fs read on absolute paths). New rows write keys.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a fresh per-job temp directory under `os.tmpdir()`. Caller MUST
 * `cleanupTempDir(...)` even on failure to avoid leaks.
 */
async function makeJobTempDir(jobId: string): Promise<string> {
  const dir = path.join(os.tmpdir(), `dm-job-${jobId}-${randomUUID()}`);
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

/**
 * Resolve `payload.storagePath` to a local file the subprocess can read.
 *
 * `payload.storagePath` is normalized by the web layer post-R34 to a
 * relative storage key (`<attachmentId>/source.<ext>`), but legacy rows
 * created before R34 still hold an absolute filesystem path. We try
 * storage first; if that fails AND the value looks like an absolute path
 * we fall back to reading from disk so existing attachments keep working.
 *
 * Returns the local path of the materialized DWG/DXF.
 */
async function materializeSource(
  storagePath: string,
  tmpDir: string,
): Promise<string> {
  const localPath = path.join(tmpDir, path.basename(storagePath) || 'source');

  // Heuristic: an absolute path is unambiguously a legacy row. Try fs
  // directly to avoid passing an unsafe key into storage.get (LocalStorage
  // would reject it via validateKey).
  if (path.isAbsolute(storagePath)) {
    await fs.access(storagePath);
    return storagePath;
  }

  // Otherwise it's a key — pull it through storage.
  const { stream } = await storage.get(storagePath);
  await pipeToFile(stream, localPath);
  return localPath;
}

interface ConversionRunResult {
  /** Local filesystem path of the produced DXF (within tmp). */
  dxfLocalPath?: string;
  fallbackUsed: 'oda' | 'libredwg';
}

/**
 * Run the actual DXF conversion, trying ODA first and falling through to
 * LibreDWG if ODA fails. Returns which adapter ultimately produced the file
 * and the local path the result was staged to (within `outDir`).
 *
 * The caller is responsible for promoting the local file into storage.
 * Throws when both adapters fail. The caller (BullMQ Worker) translates the
 * throw into a job failure / retry per the queue's `attempts` policy.
 */
async function convertDwgToDxf(
  sourcePath: string,
  outDir: string,
): Promise<{ dxfLocalPath: string; fallbackUsed: 'oda' | 'libredwg' }> {
  const target = path.join(outDir, 'preview.dxf');

  // 1) Try ODA first — it's the primary path on machines that have it.
  try {
    const { dxfPath, cleanup } = await dwgToDxf(sourcePath, {
      converterPath: ODA_CONVERTER_PATH,
    });
    try {
      await fs.copyFile(dxfPath, target);
      return { dxfLocalPath: target, fallbackUsed: 'oda' };
    } finally {
      await cleanup();
    }
  } catch (odaErr) {
    const odaMsg = odaErr instanceof Error ? odaErr.message : String(odaErr);
    log.warn({ err: odaMsg }, 'ODA failed, attempting LibreDWG fallback');

    // 2) LibreDWG fallback. If the binary isn't installed, log + rethrow the
    // ORIGINAL ODA error so the retry loop sees the real cause.
    try {
      const { dxfPath, cleanup } = await dwgToDxfLibre(sourcePath, {
        binPath: LIBREDWG_BIN,
      });
      try {
        await fs.copyFile(dxfPath, target);
        return { dxfLocalPath: target, fallbackUsed: 'libredwg' };
      } finally {
        await cleanup();
      }
    } catch (libErr) {
      if (libErr instanceof LibreDwgUnavailableError) {
        log.warn(
          { libredwgBin: LIBREDWG_BIN },
          'LibreDWG binary unavailable; not falling back further',
        );
        throw odaErr; // propagate original ODA error
      }
      // Both adapters tried and failed — surface a combined message.
      const libMsg = libErr instanceof Error ? libErr.message : String(libErr);
      const combined = new Error(
        `conversion failed (oda=${odaMsg}; libredwg=${libMsg})`,
      );
      throw combined;
    }
  }
}

async function processJob(job: Job<ConversionJobPayload>): Promise<ConversionResult> {
  const startedAt = Date.now();
  const payload = ConversionJobPayloadSchema.parse(job.data);
  const attemptNum = job.attemptsMade + 1;
  log.info(
    { jobId: payload.jobId, attachmentId: payload.attachmentId, attempt: attemptNum },
    'conversion start',
  );

  // Mark PROCESSING + bump attempt + record start time. We always update so a
  // crash mid-run leaves the row in PROCESSING (admin UI can spot stuck rows).
  await prisma.conversionJob
    .update({
      where: { id: payload.jobId },
      data: {
        status: ConversionStatus.PROCESSING,
        attempt: attemptNum,
        startedAt: new Date(),
        errorMessage: null,
      },
    })
    .catch((e) => {
      // Row may not exist if a retry was triggered against an old jobId — we
      // log and continue so the conversion itself still happens.
      log.warn({ jobId: payload.jobId, err: (e as Error).message }, 'conversion-job row update (PROCESSING) failed');
    });

  let runResult: ConversionRunResult | undefined;
  /**
   * Storage key for the produced DXF, written to `ConversionJob.dxfPath`.
   * Format: `<attachmentId>/preview.dxf`. Empty when no DXF was produced.
   */
  let dxfStorageKey: string | undefined;
  /** Storage key for the thumbnail PNG (`<attachmentId>/thumbnail.png`). */
  let thumbnailStorageKey: string | undefined;
  const tmpDir = await makeJobTempDir(payload.jobId);
  try {
    const sourceLocalPath = await materializeSource(payload.storagePath, tmpDir);

    if (payload.outputs.includes('dxf')) {
      runResult = await convertDwgToDxf(sourceLocalPath, tmpDir);
      // Promote the locally-produced DXF into storage. The key is stable —
      // <attachmentId>/preview.dxf — so the web layer can resolve it.
      const buf = await fs.readFile(runResult.dxfLocalPath!);
      const key = `${payload.attachmentId}/preview.dxf`;
      await storage.put(key, buf, { contentType: 'application/dxf' });
      dxfStorageKey = key;
    } else {
      runResult = { fallbackUsed: 'oda' };
    }

    // R29 V-INF-6 — thumbnail. Failure here is NOT a job failure: the DXF/PDF
    // conversion already succeeded, the thumbnail is best-effort. We only set
    // `thumbnailStorageKey` when the PNG truly lands so the row update below
    // can leave the column NULL on skip.
    if (payload.outputs.includes('thumbnail')) {
      const localThumbPath = path.join(tmpDir, 'thumbnail.png');
      const dxfInput = runResult?.dxfLocalPath;
      const pdfInput = await tryFindExisting(path.join(tmpDir, 'preview.pdf'));
      const thumb = await generateThumbnail(
        { dxfPath: dxfInput, pdfPath: pdfInput },
        localThumbPath,
      );
      if (thumb.success) {
        const buf = await fs.readFile(localThumbPath);
        const key = `${payload.attachmentId}/thumbnail.png`;
        await storage.put(key, buf, { contentType: 'image/png' });
        thumbnailStorageKey = key;
      } else {
        log.info(
          { jobId: payload.jobId, reason: thumb.reason },
          'thumbnail skipped',
        );
      }
    }
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const isLastAttempt = attemptNum >= (job.opts.attempts ?? 1);

    // BullMQ will retry on throw if attempts remain. Until the last attempt
    // we keep status=PROCESSING (so the row continues to look "in-flight")
    // and only stash the latest errorMessage so the admin can peek. On the
    // FINAL failed attempt we mark FAILED + finishedAt.
    await prisma.conversionJob
      .update({
        where: { id: payload.jobId },
        data: isLastAttempt
          ? {
              status: ConversionStatus.FAILED,
              errorMessage: errMessage,
              finishedAt: new Date(),
            }
          : {
              status: ConversionStatus.PROCESSING,
              errorMessage: errMessage,
            },
      })
      .catch((updateErr) => {
        log.warn(
          { jobId: payload.jobId, err: (updateErr as Error).message },
          'conversion-job row update (FAILED/PROCESSING) failed',
        );
      });

    log.error(
      { jobId: payload.jobId, attempt: attemptNum, isLastAttempt, err: errMessage },
      'conversion attempt failed',
    );
    throw err;
  } finally {
    // Always release the per-job staging area. Subprocess adapters use their
    // own temp dirs (cleaned up by `cleanup()` in convertDir), but this dir
    // also holds the materialized source + intermediate files we copied here.
    await cleanupTempDir(tmpDir);
  }

  const finishedAt = new Date();
  await prisma.conversionJob
    .update({
      where: { id: payload.jobId },
      data: {
        status: ConversionStatus.DONE,
        finishedAt,
        errorMessage: null,
        // R29 V-INF-6 / R34 V-INF-1 — persist artifact storage keys so
        // downstream readers (admin UI, thumbnail streaming endpoint) can
        // resolve them via `getStorage().get(...)` regardless of the
        // configured driver. Both columns are nullable; we only set what
        // we actually produced.
        dxfPath: dxfStorageKey ?? null,
        thumbnailPath: thumbnailStorageKey ?? null,
      },
    })
    .catch((e) => {
      log.warn({ jobId: payload.jobId, err: (e as Error).message }, 'conversion-job row update (DONE) failed');
    });

  // R40 S-1 — when the conversion produced (or already had) a PDF artifact
  // for this attachment, enqueue a pdf-extract job so the search route can
  // hit the PDF body via Postgres FTS. Best-effort: failure is logged but
  // never blocks the conversion DONE response.
  await maybeEnqueuePdfExtract(payload.attachmentId).catch((e) => {
    log.warn(
      { attachmentId: payload.attachmentId, err: (e as Error).message },
      'pdf-extract enqueue failed (non-fatal)',
    );
  });

  const result: ConversionResult = {
    jobId: payload.jobId,
    attachmentId: payload.attachmentId,
    status: 'DONE',
    dxfPath: dxfStorageKey,
    thumbnailPath: thumbnailStorageKey,
    durationMs: Date.now() - startedAt,
  };
  log.info(
    { ...result, fallbackUsed: runResult?.fallbackUsed },
    'conversion done',
  );
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// R40 S-1 — pdf-extract enqueue helper.
//
// Lazy-initialized BullMQ Queue singleton so the bootstrap path doesn't
// pay the Redis hit when the feature is disabled. We probe storage for
// the canonical preview PDF key (`<attachmentId>/preview.pdf`) — when
// present we push a job onto `pdf-extract`. The eponymous worker
// (apps/worker/src/pdf-extract-worker.ts) consumes the job and writes
// extracted text back to `Attachment.contentText`.
//
// Why probe storage instead of the ConversionJob row's `pdfPath`:
//   - The main DWG conversion writes only DXF + thumbnail today. A
//     future pipeline (DXF→PDF for preview) will land bytes at the same
//     storage key without a row column change. Probing makes us
//     forward-compatible.
//   - The print queue writes per-(ctb, pageSize) PDFs that aren't the
//     master preview — those are NOT what the search FTS should index,
//     so we deliberately do not enqueue from `pdfPrintWorker`.
// ─────────────────────────────────────────────────────────────────────────

let pdfExtractQueueSingleton: Queue<PdfExtractJobPayload> | null = null;
function getPdfExtractQueue(): Queue<PdfExtractJobPayload> {
  if (!pdfExtractQueueSingleton) {
    pdfExtractQueueSingleton = new Queue<PdfExtractJobPayload>(
      PDF_EXTRACT_QUEUE_NAME,
      {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      },
    );
  }
  return pdfExtractQueueSingleton;
}

async function maybeEnqueuePdfExtract(attachmentId: string): Promise<void> {
  // Honor the feature flag on the enqueue side too — keeps the queue
  // empty in dev/CI and matches the worker bootstrap gate.
  //
  // R41 / A — when the feature is OFF we still want /admin/pdf-extracts
  // to render a meaningful state instead of an everlasting PENDING. Mark
  // the row as SKIPPED so admins can later flip the flag + manually retry.
  if ((process.env.PDF_EXTRACT_ENABLED ?? '1') === '0') {
    await markPdfExtractSkipped(attachmentId, 'feature-disabled');
    return;
  }

  const pdfStorageKey = `${attachmentId}/preview.pdf`;
  const exists = await storage.exists(pdfStorageKey).catch(() => false);
  if (!exists) {
    log.debug({ attachmentId, pdfStorageKey }, 'pdf-extract: no preview.pdf, skip enqueue');
    // R41 / A — same rationale as above: a non-PDF attachment (or one
    // whose preview pipeline never produced a PDF) should be visibly
    // SKIPPED in /admin/pdf-extracts. An admin can later trigger a
    // re-conversion + retry if appropriate.
    await markPdfExtractSkipped(attachmentId, 'no-preview-pdf');
    return;
  }

  const queue = getPdfExtractQueue();
  await queue.add(
    'extract',
    { attachmentId, pdfStorageKey },
    // jobId dedup: one in-flight extract per attachment (an older retry
    // for the same attachment is replaced by the newer enqueue).
    { jobId: `${attachmentId}:${pdfStorageKey}` },
  );
  log.info({ attachmentId, pdfStorageKey }, 'pdf-extract enqueued');
}

/**
 * R41 / A — flip the row to SKIPPED when the conversion DONE branch
 * decided not to enqueue a pdf-extract job. Idempotent: only collapses
 * from PENDING so a manual admin retry (which sets PENDING) is the
 * single legitimate way to leave a SKIPPED state — but a row already in
 * EXTRACTING/DONE/FAILED is left alone. Row deletion (P2025-equivalent)
 * just no-ops via updateMany's count semantics.
 */
async function markPdfExtractSkipped(
  attachmentId: string,
  reason: 'feature-disabled' | 'no-preview-pdf',
): Promise<void> {
  try {
    const result = await prisma.attachment.updateMany({
      where: { id: attachmentId, pdfExtractStatus: 'PENDING' },
      data: {
        pdfExtractStatus: 'SKIPPED',
        pdfExtractAt: new Date(),
        pdfExtractError: null,
      },
    });
    log.debug(
      { attachmentId, reason, updated: result.count },
      'pdf-extract marked SKIPPED',
    );
  } catch (e) {
    log.warn(
      { attachmentId, reason, err: (e as Error).message },
      'pdf-extract: failed to mark SKIPPED (non-fatal)',
    );
  }
}

/**
 * Return `path` if the file exists, else `undefined`. Used to feed the
 * thumbnail generator with whatever artifacts happen to be on disk (the
 * DXF we just produced, plus any pre-existing preview.pdf from a future
 * pipeline). Never throws.
 */
async function tryFindExisting(p: string): Promise<string | undefined> {
  try {
    await fs.access(p);
    return p;
  } catch {
    return undefined;
  }
}

const worker = new Worker<ConversionJobPayload, ConversionResult>(
  CONVERSION_QUEUE_NAME,
  processJob,
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3),
  },
);

worker.on('completed', (job, result) => {
  log.info({ jobId: result.jobId, durationMs: result.durationMs }, 'job completed');
});
worker.on('failed', (job, err) => {
  log.error({ jobId: job?.data?.jobId, err: err.message }, 'conversion failed');
});

// ─────────────────────────────────────────────────────────────────────────
// R31 P-1 — pdf-print queue worker.
//
// Consumes PdfPrintJobPayload jobs and runs `generatePdfFromDxf` (pdf-lib
// MIT, no GPL deps). Uses the same ConversionJob row for status tracking
// so the admin UI / status polling endpoint don't need a second model.
//
// Job lifecycle on the row:
//   PENDING  (set by enqueuer)
//     → PROCESSING (we set on entry; bumps `attempt`)
//       → DONE     (we set on success; sets `finishedAt`)
//       OR
//       → FAILED   (we set ONLY on the final attempt; intermediate retries
//                   keep status=PROCESSING with errorMessage updated so
//                   admin can spot in-flight retries)
//
// Output (storage key, R34 V-INF-1): <attachmentId>/print-<ctb>-<pageSize>.pdf.
// Backend reads it via `getStorage().get(key)` — works for both Local and
// S3 drivers. We don't persist the PDF key on the row — there's no metadata
// column and the key is deterministic from the payload, so callers can
// resolve it themselves. Adding a column is tracked as a follow-up if cache
// hit detection on the API side needs O(1) row reads.
// ─────────────────────────────────────────────────────────────────────────

async function processPdfPrintJob(
  job: Job<PdfPrintJobPayload>,
): Promise<PdfPrintResult> {
  const startedAt = Date.now();
  const payload = PdfPrintJobPayloadSchema.parse(job.data);
  const attemptNum = job.attemptsMade + 1;
  log.info(
    {
      jobId: payload.jobId,
      attachmentId: payload.attachmentId,
      ctb: payload.ctb,
      pageSize: payload.pageSize,
      attempt: attemptNum,
    },
    'pdf-print start',
  );

  await prisma.conversionJob
    .update({
      where: { id: payload.jobId },
      data: {
        status: ConversionStatus.PROCESSING,
        attempt: attemptNum,
        startedAt: new Date(),
        errorMessage: null,
      },
    })
    .catch((e) => {
      log.warn(
        { jobId: payload.jobId, err: (e as Error).message },
        'pdf-print row update (PROCESSING) failed',
      );
    });

  let pdfStorageKey: string | undefined;
  const tmpDir = await makeJobTempDir(payload.jobId);
  try {
    // Resolve the DXF input. Prefer the pre-converted hint on the payload
    // (already a storage key post-R34, or a legacy absolute path). If the
    // hint is missing or unreadable we re-convert from the DWG source.
    let dxfLocalPath: string | undefined;
    if (payload.dxfPath) {
      try {
        if (path.isAbsolute(payload.dxfPath)) {
          // Legacy absolute path.
          await fs.access(payload.dxfPath);
          dxfLocalPath = payload.dxfPath;
        } else {
          // Storage key — pull into tmp.
          const local = path.join(tmpDir, 'preview.dxf');
          const { stream } = await storage.get(payload.dxfPath);
          await pipeToFile(stream, local);
          dxfLocalPath = local;
        }
      } catch (err) {
        log.warn(
          { jobId: payload.jobId, dxfPath: payload.dxfPath, err: (err as Error).message },
          'pdf-print: hinted dxfPath missing, will convert from DWG',
        );
        dxfLocalPath = undefined;
      }
    }
    if (!dxfLocalPath) {
      const sourceLocalPath = await materializeSource(payload.storagePath, tmpDir);
      const conv = await convertDwgToDxf(sourceLocalPath, tmpDir);
      dxfLocalPath = conv.dxfLocalPath;
    }

    const result = await generatePdfFromDxf(dxfLocalPath, {
      ctb: payload.ctb,
      pageSize: payload.pageSize,
    });

    if (result.entityCount === 0) {
      // The DXF parsed but had no Phase-1-supported geometry. Surface a
      // useful error rather than write an empty PDF the user will then
      // wonder about.
      throw new Error(
        `no drawable entities found (skipped kinds: ${result.skippedKinds.join(', ') || 'none'})`,
      );
    }

    pdfStorageKey = `${payload.attachmentId}/print-${payload.ctb}-${payload.pageSize}.pdf`;
    await storage.put(pdfStorageKey, result.pdf, {
      contentType: 'application/pdf',
    });
    log.info(
      {
        jobId: payload.jobId,
        pdfStorageKey,
        entityCount: result.entityCount,
        skippedKinds: result.skippedKinds,
      },
      'pdf-print rendered',
    );
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const isLastAttempt = attemptNum >= (job.opts.attempts ?? 1);

    await prisma.conversionJob
      .update({
        where: { id: payload.jobId },
        data: isLastAttempt
          ? {
              status: ConversionStatus.FAILED,
              errorMessage: errMessage,
              finishedAt: new Date(),
            }
          : {
              status: ConversionStatus.PROCESSING,
              errorMessage: errMessage,
            },
      })
      .catch((updateErr) => {
        log.warn(
          { jobId: payload.jobId, err: (updateErr as Error).message },
          'pdf-print row update (FAILED/PROCESSING) failed',
        );
      });

    log.error(
      {
        jobId: payload.jobId,
        attempt: attemptNum,
        isLastAttempt,
        err: errMessage,
      },
      'pdf-print attempt failed',
    );
    throw err;
  } finally {
    await cleanupTempDir(tmpDir);
  }

  await prisma.conversionJob
    .update({
      where: { id: payload.jobId },
      data: {
        status: ConversionStatus.DONE,
        finishedAt: new Date(),
        errorMessage: null,
      },
    })
    .catch((e) => {
      log.warn(
        { jobId: payload.jobId, err: (e as Error).message },
        'pdf-print row update (DONE) failed',
      );
    });

  const result: PdfPrintResult = {
    jobId: payload.jobId,
    attachmentId: payload.attachmentId,
    status: 'DONE',
    pdfPath: pdfStorageKey,
    durationMs: Date.now() - startedAt,
  };
  log.info(result, 'pdf-print done');
  return result;
}

/**
 * Pipe a `NodeJS.ReadableStream` to a file path. Used to materialize storage
 * objects (source DWG, hinted DXF) into local files the subprocess adapters
 * + pdf-lib can read.
 */
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

const pdfPrintWorker = new Worker<PdfPrintJobPayload, PdfPrintResult>(
  PDF_PRINT_QUEUE_NAME,
  processPdfPrintJob,
  {
    connection,
    // PDF rendering is CPU-bound (pdf-lib serialization). Keep concurrency
    // separate from DWG conversion, defaults to 2.
    concurrency: Number(process.env.PDF_PRINT_CONCURRENCY ?? 2),
  },
);

pdfPrintWorker.on('completed', (_job, result) => {
  log.info(
    { jobId: result.jobId, durationMs: result.durationMs },
    'pdf-print job completed',
  );
});
pdfPrintWorker.on('failed', (job, err) => {
  log.error(
    { jobId: job?.data?.jobId, err: err.message },
    'pdf-print failed',
  );
});

// ─────────────────────────────────────────────────────────────────────────
// R33 D-5 — backup queue worker.
//
// Handles POSTGRES (pg_dump) + FILES (tar) snapshot jobs and self-schedules
// daily repeatables when BACKUP_CRON_ENABLED=1. Implementation isolated in
// ./backup-worker.ts to keep this file's concerns to wiring + shutdown.
// ─────────────────────────────────────────────────────────────────────────

const backupWorkerHandle = startBackupWorker({ connection, prisma, log });

// ─────────────────────────────────────────────────────────────────────────
// R35 N-1 — mail queue worker.
//
// Consumes outbound notification emails enqueued by web's
// `enqueueNotification`. Returns `null` (skipped) when MAIL_ENABLED!='1' —
// matches the behavior on the web side so dev/CI never spin up an SMTP
// connection. Implementation isolated in ./mail-worker.ts.
// ─────────────────────────────────────────────────────────────────────────

const mailWorkerHandle = startMailWorker({ connection, log });

// ─────────────────────────────────────────────────────────────────────────
// R36 V-INF-3 — virus-scan queue worker.
//
// Runs ClamAV against each newly-uploaded Attachment via subprocess
// (`clamscan` CLI) or clamd TCP INSTREAM (when CLAMAV_USE_CLAMD=1).
// The worker stays bootable even when CLAMAV_ENABLED!='1' — in that
// mode every job resolves to SKIPPED so attachments don't sit in
// PENDING forever. ClamAV is GPL-2; we never import a JS binding,
// only spawn the binary or open a raw TCP socket. See ./clamav.ts.
// ─────────────────────────────────────────────────────────────────────────

const scanWorkerHandle = startScanWorker({ connection, prisma, log });

// ─────────────────────────────────────────────────────────────────────────
// R38 N-2 — SMS + KakaoTalk Bizmessage queue workers.
//
// Mirror of the R35 mail worker pattern. Each channel runs in its own
// BullMQ worker so a provider outage on one channel doesn't stall retries
// on the other. Both return `null` when their respective ENABLED env is
// off (matches the web-side enqueue gate so the queues stay empty in
// dev/CI). Implementations: ./sms-worker.ts + ./kakao-worker.ts.
//
// License posture (audited):
//   - twilio: Apache 2.0 (loaded lazily; only imported when SMS_DRIVER=twilio).
//   - kakao driver: no SDK at all — uses Node 22 global fetch.
//   - GPL/AGPL JS deps: 0.
// ─────────────────────────────────────────────────────────────────────────

const smsWorkerHandle = startSmsWorker({ connection, log });
const kakaoWorkerHandle = startKakaoWorker({ connection, log });

// ─────────────────────────────────────────────────────────────────────────
// R40 S-1 — pdf-extract queue worker.
//
// Pulls bytes for `<attachmentId>/preview.pdf` from storage, extracts
// text via pdfjs-dist (Apache 2.0; legacy Node build), writes to
// `Attachment.contentText`. The Postgres GENERATED column `content_tsv`
// (migration 0014) picks up the new value automatically — no separate
// write needed. Disabled when PDF_EXTRACT_ENABLED=0 (matches the
// enqueue gate above so the queue stays empty).
// ─────────────────────────────────────────────────────────────────────────

const pdfExtractWorkerHandle = startPdfExtractWorker({
  connection,
  prisma,
  log,
  storage,
});

// ─────────────────────────────────────────────────────────────────────────
// R-AUDIT-TREND — security-audit queue worker.
//
// Daily snapshot of `pnpm audit --json` results to SecurityAuditSnapshot
// (FIND-016 mitigation). When SECURITY_AUDIT_CRON_ENABLED=1 the worker
// also enrolls a repeatable on SECURITY_AUDIT_CRON_PATTERN (default
// '30 2 * * *' to avoid colliding with the backup cron at 02:00).
// SUPER_ADMIN-triggered manual snapshots arrive on the same queue.
//
// License posture: pnpm audit subprocess only — no JS audit binding,
// no GPL transitive imports.
// ─────────────────────────────────────────────────────────────────────────

const securityAuditWorkerHandle = startSecurityAuditWorker({
  connection,
  prisma,
  log,
});

// ─────────────────────────────────────────────────────────────────────────
// R-PDF-MERGE — pdf-merge queue worker.
//
// Backlog P-2 As-Is parity. Bulk merge of N attachments (≤50) into a
// single PDF the user downloads from the search results toolbar. Reuses
// the ConversionJob row (metadata.kind='PDF_MERGE') for status tracking
// so the same admin/status surface works without a second model. Uses
// pdf-lib (MIT) only — GPL/AGPL direct link 0.
// ─────────────────────────────────────────────────────────────────────────

const pdfMergeWorkerHandle = startPdfMergeWorker({
  connection,
  prisma,
  log,
  storage,
});

const shutdown = async (sig: string) => {
  log.info({ sig }, 'worker shutting down');
  await Promise.all([
    worker.close(),
    pdfPrintWorker.close(),
    pdfMergeWorkerHandle.close(),
    backupWorkerHandle.close(),
    scanWorkerHandle.close(),
    // Optional channel workers — disabled when their ENABLED env is off.
    mailWorkerHandle ? mailWorkerHandle.close() : Promise.resolve(),
    smsWorkerHandle ? smsWorkerHandle.close() : Promise.resolve(),
    kakaoWorkerHandle ? kakaoWorkerHandle.close() : Promise.resolve(),
    pdfExtractWorkerHandle ? pdfExtractWorkerHandle.close() : Promise.resolve(),
    // R-AUDIT-TREND — security-audit worker close.
    securityAuditWorkerHandle.close(),
    // Close the enqueue-side Queue too if we ever opened it during this
    // process's lifetime (lazy-init in `getPdfExtractQueue`).
    pdfExtractQueueSingleton ? pdfExtractQueueSingleton.close() : Promise.resolve(),
  ]);
  await prisma.$disconnect().catch(() => undefined);
  await connection.quit();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log.info(
  {
    queues: [
      CONVERSION_QUEUE_NAME,
      PDF_PRINT_QUEUE_NAME,
      PDF_MERGE_QUEUE_NAME,
      'backup',
      'virus-scan',
      ...(mailWorkerHandle ? ['mail'] : []),
      ...(smsWorkerHandle ? ['sms'] : []),
      ...(kakaoWorkerHandle ? ['kakao'] : []),
      ...(pdfExtractWorkerHandle ? [PDF_EXTRACT_QUEUE_NAME] : []),
      'security-audit',
    ],
    redis: REDIS_URL,
    oda: ODA_CONVERTER_PATH,
    libredwg: LIBREDWG_BIN,
    mailEnabled: process.env.MAIL_ENABLED === '1',
    clamavEnabled: process.env.CLAMAV_ENABLED === '1',
    smsEnabled: process.env.SMS_ENABLED === '1',
    kakaoEnabled: process.env.KAKAO_ENABLED === '1',
    pdfExtractEnabled: (process.env.PDF_EXTRACT_ENABLED ?? '1') !== '0',
  },
  'worker started',
);
