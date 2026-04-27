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

import { Worker, type Job } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import pino from 'pino';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PrismaClient, ConversionStatus } from '@prisma/client';
import {
  CONVERSION_QUEUE_NAME,
  ConversionJobPayloadSchema,
  PDF_PRINT_QUEUE_NAME,
  PdfPrintJobPayloadSchema,
  type ConversionJobPayload,
  type ConversionResult,
  type PdfPrintJobPayload,
  type PdfPrintResult,
} from '@drawing-mgmt/shared/conversion';
import { dwgToDxf } from './oda.js';
import { dwgToDxfLibre, LibreDwgUnavailableError } from './libredwg.js';
import { generateThumbnail } from './thumbnail.js';
import { generatePdfFromDxf } from './pdf.js';
import { startBackupWorker } from './backup-worker.js';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const ODA_CONVERTER_PATH =
  process.env.ODA_CONVERTER_PATH ??
  'C:/Program Files/ODA/ODAFileConverter 27.1.0/ODAFileConverter.exe';
const LIBREDWG_BIN = process.env.LIBREDWG_DWG2DXF_PATH ?? 'dwg2dxf';
const FILE_STORAGE_ROOT = path.resolve(
  process.env.FILE_STORAGE_ROOT ?? './.data/files',
);

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

interface ConversionRunResult {
  dxfOutPath?: string;
  fallbackUsed: 'oda' | 'libredwg';
}

/**
 * Run the actual DXF conversion, trying ODA first and falling through to
 * LibreDWG if ODA fails. Returns which adapter ultimately produced the file.
 *
 * Throws when both adapters fail. The caller (BullMQ Worker) translates the
 * throw into a job failure / retry per the queue's `attempts` policy.
 */
async function convertDwgToDxf(
  sourcePath: string,
  outDir: string,
): Promise<{ dxfOutPath: string; fallbackUsed: 'oda' | 'libredwg' }> {
  const target = path.join(outDir, 'preview.dxf');

  // 1) Try ODA first — it's the primary path on machines that have it.
  try {
    const { dxfPath, cleanup } = await dwgToDxf(sourcePath, {
      converterPath: ODA_CONVERTER_PATH,
    });
    try {
      await fs.copyFile(dxfPath, target);
      return { dxfOutPath: target, fallbackUsed: 'oda' };
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
        return { dxfOutPath: target, fallbackUsed: 'libredwg' };
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
  let thumbnailOutPath: string | undefined;
  try {
    const sourcePath = path.resolve(payload.storagePath);
    await fs.access(sourcePath);

    const outDir = path.join(FILE_STORAGE_ROOT, payload.attachmentId);
    await fs.mkdir(outDir, { recursive: true });

    if (payload.outputs.includes('dxf')) {
      runResult = await convertDwgToDxf(sourcePath, outDir);
    } else {
      runResult = { fallbackUsed: 'oda' };
    }

    // R29 V-INF-6 — thumbnail. Failure here is NOT a job failure: the DXF/PDF
    // conversion already succeeded, the thumbnail is best-effort. We only set
    // `thumbnailOutPath` when the file truly lands so the row update below
    // can leave the column NULL on skip.
    if (payload.outputs.includes('thumbnail')) {
      const candidate = path.join(outDir, 'thumbnail.png');
      const dxfInput =
        runResult?.dxfOutPath ?? (await tryFindExisting(path.join(outDir, 'preview.dxf')));
      const pdfInput = await tryFindExisting(path.join(outDir, 'preview.pdf'));
      const thumb = await generateThumbnail(
        { dxfPath: dxfInput, pdfPath: pdfInput },
        candidate,
      );
      if (thumb.success) {
        thumbnailOutPath = candidate;
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
  }

  const finishedAt = new Date();
  await prisma.conversionJob
    .update({
      where: { id: payload.jobId },
      data: {
        status: ConversionStatus.DONE,
        finishedAt,
        errorMessage: null,
        // R29 V-INF-6 — persist artifact paths so downstream readers (admin
        // UI, thumbnail streaming endpoint) can resolve them without
        // re-deriving the storage layout. Both columns are nullable; we
        // only set what we actually produced.
        dxfPath: runResult?.dxfOutPath ?? null,
        thumbnailPath: thumbnailOutPath ?? null,
      },
    })
    .catch((e) => {
      log.warn({ jobId: payload.jobId, err: (e as Error).message }, 'conversion-job row update (DONE) failed');
    });

  const result: ConversionResult = {
    jobId: payload.jobId,
    attachmentId: payload.attachmentId,
    status: 'DONE',
    dxfPath: runResult?.dxfOutPath,
    thumbnailPath: thumbnailOutPath,
    durationMs: Date.now() - startedAt,
  };
  log.info(
    { ...result, fallbackUsed: runResult?.fallbackUsed },
    'conversion done',
  );
  return result;
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
// Output: <FILE_STORAGE_ROOT>/<attachmentId>/print-<ctb>-<pageSize>.pdf.
// We don't persist the PDF path on the row — there's no metadata column
// and the path is deterministic from the payload, so callers can resolve
// it themselves. Adding a column is tracked as a follow-up if cache hit
// detection on the API side needs O(1) row reads.
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

  let pdfOutPath: string | undefined;
  try {
    const outDir = path.join(FILE_STORAGE_ROOT, payload.attachmentId);
    await fs.mkdir(outDir, { recursive: true });

    // Resolve the DXF input. Prefer the pre-converted path on the payload;
    // fall back to converting from DWG if missing or unreadable.
    let dxfPath = payload.dxfPath ? path.resolve(payload.dxfPath) : undefined;
    if (dxfPath) {
      try {
        await fs.access(dxfPath);
      } catch {
        log.warn(
          { jobId: payload.jobId, dxfPath },
          'pdf-print: hinted dxfPath missing, will convert from DWG',
        );
        dxfPath = undefined;
      }
    }
    if (!dxfPath) {
      const sourcePath = path.resolve(payload.storagePath);
      await fs.access(sourcePath);
      const conv = await convertDwgToDxf(sourcePath, outDir);
      dxfPath = conv.dxfOutPath;
    }

    pdfOutPath = path.join(
      outDir,
      `print-${payload.ctb}-${payload.pageSize}.pdf`,
    );
    const result = await generatePdfFromDxf(dxfPath, {
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

    await fs.writeFile(pdfOutPath, result.pdf);
    log.info(
      {
        jobId: payload.jobId,
        pdfOutPath,
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
    pdfPath: pdfOutPath,
    durationMs: Date.now() - startedAt,
  };
  log.info(result, 'pdf-print done');
  return result;
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

const shutdown = async (sig: string) => {
  log.info({ sig }, 'worker shutting down');
  await Promise.all([
    worker.close(),
    pdfPrintWorker.close(),
    backupWorkerHandle.close(),
  ]);
  await prisma.$disconnect().catch(() => undefined);
  await connection.quit();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log.info(
  {
    queues: [CONVERSION_QUEUE_NAME, PDF_PRINT_QUEUE_NAME, 'backup'],
    redis: REDIS_URL,
    oda: ODA_CONVERTER_PATH,
    libredwg: LIBREDWG_BIN,
  },
  'worker started',
);
