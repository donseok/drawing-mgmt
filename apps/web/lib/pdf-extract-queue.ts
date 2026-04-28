// R41 / A — PDF extract queue (BullMQ `pdf-extract`) helper for the web app.
//
// Mirrors `scan-queue.ts`: lazy IORedis singleton + lazy Queue singleton, so
// importing this module from a route does NOT open a Redis connection until
// somebody actually enqueues. The worker (apps/worker/src/pdf-extract-worker.ts)
// consumes jobs from the same queue name and updates the Attachment row's
// `pdfExtractStatus`.
//
// Why a separate file (rather than re-importing from `apps/worker/src`):
//   - The worker package is its own pnpm workspace and the web app must not
//     pull worker-bootstrap (pdfjs-dist eager-load, BullMQ Worker class, etc.)
//     into its bundle. Keeping the small enqueue API local is the smallest
//     possible surface area.
//   - The retry endpoint only needs `add()` + `getJob()/remove()` — never
//     `process()`. Importing the worker would also pull `pdfjs-dist` into
//     the Next.js server bundle for no benefit.
//
// Used by:
//   - POST /api/v1/admin/pdf-extracts/{id}/retry — re-enqueue after FAILED/SKIPPED.

import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import {
  PDF_EXTRACT_QUEUE_NAME,
  PdfExtractJobPayloadSchema,
  type PdfExtractJobPayload,
} from '@drawing-mgmt/shared/conversion';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Mirror the worker-side enqueue defaults (3 attempts + exponential backoff)
 * so an admin-triggered retry behaves identically to an automatic enqueue
 * from the conversion DONE branch.
 */
export const PDF_EXTRACT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

let queueSingleton: Queue<PdfExtractJobPayload> | null = null;
let connectionSingleton: Redis | null = null;

function getConnection(): Redis {
  if (!connectionSingleton) {
    connectionSingleton = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connectionSingleton;
}

export function getPdfExtractQueue(): Queue<PdfExtractJobPayload> {
  if (!queueSingleton) {
    queueSingleton = new Queue<PdfExtractJobPayload>(PDF_EXTRACT_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: PDF_EXTRACT_JOB_OPTIONS,
    });
  }
  return queueSingleton;
}

export interface RequeuePdfExtractInput {
  attachmentId: string;
  pdfStorageKey: string;
}

export interface RequeuePdfExtractResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Re-enqueue a pdf-extract job. The worker uses `<attachmentId>:<pdfStorageKey>`
 * as the BullMQ job id (see apps/worker/src/index.ts maybeEnqueuePdfExtract),
 * so we mirror that here and remove any prior job with the same id first to
 * avoid the BullMQ duplicate-id rejection.
 *
 * Returns `{ ok: false, error }` on failure rather than throwing, so the
 * retry endpoint can roll the row back to FAILED with a meaningful 5xx
 * payload instead of letting the request stack-trace.
 */
export async function requeuePdfExtract(
  input: RequeuePdfExtractInput,
): Promise<RequeuePdfExtractResult> {
  const payload: PdfExtractJobPayload = {
    attachmentId: input.attachmentId,
    pdfStorageKey: input.pdfStorageKey,
  };
  const parsed = PdfExtractJobPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: `invalid pdf-extract payload: ${parsed.error.message}` };
  }

  const jobId = `${input.attachmentId}:${input.pdfStorageKey}`;
  try {
    const queue = getPdfExtractQueue();
    // Remove the old job (idempotent) so the new add() isn't rejected
    // for a duplicate jobId. Failures here are fine — the prior job may
    // already be reaped by `removeOnComplete`/`removeOnFail`.
    try {
      const existing = await queue.getJob(jobId);
      if (existing) await existing.remove();
    } catch {
      /* ignore */
    }
    const job = await queue.add('extract', parsed.data, { jobId });
    return { ok: true, jobId: job.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[pdf-extract-queue] requeue failed', err);
    return { ok: false, error: message };
  }
}
