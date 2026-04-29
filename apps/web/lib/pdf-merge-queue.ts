// R-PDF-MERGE — lazy BullMQ Queue singleton for the `pdf-merge` queue.
//
// Web side. Wired identically to backup-queue.ts and conversion-queue.ts so
// the singleton + Redis connection patterns stay consistent across queues.
//
// Pushes `PdfMergeJobPayload` jobs onto the dedicated `pdf-merge` queue. The
// worker (apps/worker/src/pdf-merge-worker.ts) consumes and writes the
// merged PDF to `<aggregateJobId>/merged.pdf` via the storage abstraction.
//
// We do NOT reuse `getPrintQueue()` from conversion-queue.ts: the print
// queue's payload shape (`PrintJobPayload`) is per-attachment + ctb/pageSize
// only, while bulk-merge needs an array of attachmentIds + an aggregate
// jobId. A dedicated queue keeps payload contracts precise and avoids
// head-of-line blocking with single-attachment print requests.
//
// Lazy singleton: Queue construction opens a Redis socket. Importing this
// module from a route should not pay that cost during build/static analysis.

import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import {
  PDF_MERGE_QUEUE_NAME,
  type PdfMergeJobPayload,
} from '@drawing-mgmt/shared/conversion';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Retry policy mirrored on the worker side. Single attempt: bulk-merge
 * accumulates partial results in `metadata.failures[]` and BullMQ retry
 * would replay the entire merge. Users can retrigger from the FE if they
 * want a fresh run.
 */
export const PDF_MERGE_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 60 * 60, count: 200 },
  removeOnFail: { age: 24 * 60 * 60, count: 200 },
};

let queueSingleton: Queue<PdfMergeJobPayload> | null = null;
let connectionSingleton: Redis | null = null;

function getConnection(): Redis {
  if (!connectionSingleton) {
    // BullMQ requires `maxRetriesPerRequest: null` on the connection.
    connectionSingleton = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connectionSingleton;
}

export function getPdfMergeQueue(): Queue<PdfMergeJobPayload> {
  if (!queueSingleton) {
    queueSingleton = new Queue<PdfMergeJobPayload>(PDF_MERGE_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: PDF_MERGE_JOB_OPTIONS,
    });
  }
  return queueSingleton;
}
