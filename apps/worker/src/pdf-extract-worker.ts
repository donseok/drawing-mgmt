/**
 * R40 S-1 — BullMQ worker for the `pdf-extract` queue.
 *
 * Consumes `PdfExtractJobPayload` jobs and runs `./pdf-extract.ts` to
 * pull PDF body text via `pdfjs-dist`, then writes the result to
 * `Attachment.contentText`. The Postgres GENERATED column
 * `content_tsv` (migration 0014) automatically picks up the new value,
 * making the row immediately searchable via the search route's
 * `to_tsquery('simple', $1) @@ "Attachment"."content_tsv"` query.
 *
 * Lifecycle:
 *   1. Job lands in `pdf-extract` queue (enqueued by main worker on
 *      ConversionJob DONE; future rounds may also enqueue from the
 *      attachments route for direct PDF uploads).
 *   2. Worker validates payload via PdfExtractJobPayloadSchema.
 *   3. Worker calls storage.get(pdfStorageKey) — buffers bytes
 *      (PDFs are small enough that streaming buys little, and pdfjs
 *      needs the whole file anyway).
 *   4. Worker calls extractPdfText(buf) → string.
 *   5. Worker calls prisma.attachment.update({ contentText }).
 *   6. On any throw → BullMQ retries per attempts policy. Final failure
 *      leaves contentText NULL (search just won't match the row).
 *
 * Why a separate worker file (vs inlining in index.ts):
 *   - Mirrors the pattern set by ./mail-worker.ts / ./scan-worker.ts.
 *   - Lazy `pdfjs-dist` import lives in ./pdf-extract.ts, so the worker
 *     bootstrap stays cheap when PDF_EXTRACT_ENABLED=0.
 *
 * License posture: pdfjs-dist Apache 2.0. ClamAV / LibreDWG-style GPL
 * isolation NOT required here.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis as IORedis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import {
  PDF_EXTRACT_QUEUE_NAME,
  PdfExtractJobPayloadSchema,
  type PdfExtractJobPayload,
  type PdfExtractResult,
} from '@drawing-mgmt/shared/conversion';
import { extractPdfText } from './pdf-extract.js';
import { getStorage, type Storage } from './storage.js';

export interface PdfExtractWorkerHandle {
  worker: Worker<PdfExtractJobPayload, PdfExtractResult>;
  close: () => Promise<void>;
}

interface StartDeps {
  connection: IORedis;
  prisma: PrismaClient;
  log: pino.Logger;
  /**
   * Override the storage instance — useful for tests that want to inject
   * an in-memory driver. Defaults to `getStorage()` (factory singleton).
   */
  storage?: Storage;
}

/**
 * Pull every byte from a Readable into a single Buffer. PDFs are small
 * enough (typically 1–20 MB) that the whole-file approach is fine and
 * pdfjs's `getDocument({ data })` API needs the bytes contiguous anyway.
 */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk, 'utf8'));
    } else {
      // Uint8Array / ArrayBufferView from a binary stream.
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
  }
  return Buffer.concat(chunks);
}

/**
 * Run a single extraction job. Exported so unit tests can drive the
 * handler with a synthesized BullMQ Job stub instead of standing up the
 * full Worker + Redis.
 */
export async function processPdfExtractJob(
  job: Job<PdfExtractJobPayload>,
  deps: { prisma: PrismaClient; storage: Storage; log: pino.Logger },
): Promise<PdfExtractResult> {
  const { prisma, storage, log } = deps;
  const startedAt = Date.now();
  const payload = PdfExtractJobPayloadSchema.parse(job.data);
  const attemptNum = job.attemptsMade + 1;

  log.info(
    {
      attachmentId: payload.attachmentId,
      pdfStorageKey: payload.pdfStorageKey,
      attempt: attemptNum,
    },
    'pdf-extract start',
  );

  try {
    // 1) Load PDF bytes from storage.
    const { stream } = await storage.get(payload.pdfStorageKey);
    const buf = await streamToBuffer(stream);

    // 2) Extract text. Empty PDFs (or pages with no TextItems) resolve
    //    to an empty string — we still record that as DONE with charCount=0
    //    so admins can distinguish "extracted, nothing there" from
    //    "extraction never ran".
    const text = await extractPdfText(buf);
    const trimmed = text.trim();

    // 3) Update the row. We tolerate the row having been deleted between
    //    enqueue and consumption (cascade from Attachment / Version /
    //    Revision / Object); a missing row is logged + treated as DONE
    //    with no side effect.
    try {
      await prisma.attachment.update({
        where: { id: payload.attachmentId },
        data: { contentText: trimmed.length > 0 ? trimmed : null },
      });
    } catch (e) {
      // P2025 = "An operation failed because it depends on one or more
      // records that were required but not found."  — row gone.
      if ((e as { code?: string }).code === 'P2025') {
        log.warn(
          { attachmentId: payload.attachmentId },
          'pdf-extract: attachment row not found, skipping update',
        );
      } else {
        throw e;
      }
    }

    const result: PdfExtractResult = {
      attachmentId: payload.attachmentId,
      status: 'DONE',
      charCount: trimmed.length,
      durationMs: Date.now() - startedAt,
    };
    log.info(result, 'pdf-extract done');
    return result;
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const isLastAttempt = attemptNum >= (job.opts.attempts ?? 1);
    log.error(
      {
        attachmentId: payload.attachmentId,
        pdfStorageKey: payload.pdfStorageKey,
        attempt: attemptNum,
        isLastAttempt,
        err: errMessage,
      },
      'pdf-extract attempt failed',
    );
    // Always rethrow — BullMQ honors attempts/backoff via the queue's
    // job options (set on the enqueuer side; defaults are 3 + exp).
    throw err;
  }
}

/**
 * Start the BullMQ worker for the `pdf-extract` queue. Caller is
 * responsible for closing the returned handle on SIGTERM. Returns
 * `null` when PDF_EXTRACT_ENABLED is not '1' so the caller can skip
 * wiring (and importantly, the matching enqueue gate on the main
 * worker is also off so the queue stays empty).
 */
export function startPdfExtractWorker(deps: StartDeps): PdfExtractWorkerHandle | null {
  const { connection, prisma, log } = deps;
  // Default ON ('1') — text extraction is cheap, in-memory, no external
  // service. Only the explicit '0' opt-out disables it.
  const enabled = (process.env.PDF_EXTRACT_ENABLED ?? '1') !== '0';
  if (!enabled) {
    log.info('pdf-extract worker disabled (PDF_EXTRACT_ENABLED=0)');
    return null;
  }

  const storage: Storage = deps.storage ?? getStorage();

  const worker = new Worker<PdfExtractJobPayload, PdfExtractResult>(
    PDF_EXTRACT_QUEUE_NAME,
    (job) => processPdfExtractJob(job, { prisma, storage, log }),
    {
      connection,
      // pdfjs is single-threaded; we keep concurrency modest so a batch
      // of fresh uploads doesn't pile up RAM. Tunable via env for ops.
      concurrency: Number(process.env.PDF_EXTRACT_CONCURRENCY ?? 2),
    },
  );

  worker.on('completed', (_job, result) => {
    log.info(
      {
        attachmentId: result.attachmentId,
        charCount: result.charCount,
        durationMs: result.durationMs,
      },
      'pdf-extract job completed',
    );
  });
  worker.on('failed', (job, err) => {
    log.error(
      { attachmentId: job?.data?.attachmentId, err: err.message },
      'pdf-extract job failed',
    );
  });

  log.info(
    { concurrency: process.env.PDF_EXTRACT_CONCURRENCY ?? 2 },
    'pdf-extract worker started',
  );

  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}
