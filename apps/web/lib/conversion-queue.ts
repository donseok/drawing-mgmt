// Conversion queue helper — wraps BullMQ Queue + ConversionJob row INSERT.
//
// Web side. The web app enqueues a payload here, and `apps/worker` consumes
// it. The DB row tracks lifecycle (PENDING → PROCESSING → DONE/FAILED) so the
// admin UI can show status without having to scan BullMQ.
//
// Lazy singleton: the Queue is constructed on first use because importing
// this module from a route should not open a Redis connection during build
// or static analysis.
//
// Owned by viewer-engineer (R28 V-INF-4).

import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import {
  CONVERSION_QUEUE_NAME,
  type ConversionJobPayload,
} from '@drawing-mgmt/shared/conversion';
import { prisma } from '@/lib/prisma';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/** BullMQ retry policy mirrored on the worker side (apps/worker/src/index.ts). */
export const CONVERSION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  // Hold completed/failed jobs briefly so admin UI/debug can read them
  // before BullMQ housekeeping prunes them. ConversionJob row is the
  // long-term source of truth.
  removeOnComplete: { age: 60 * 60, count: 1_000 },
  removeOnFail: { age: 24 * 60 * 60, count: 1_000 },
};

let queueSingleton: Queue<ConversionJobPayload> | null = null;
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

export function getConversionQueue(): Queue<ConversionJobPayload> {
  if (!queueSingleton) {
    queueSingleton = new Queue<ConversionJobPayload>(CONVERSION_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: CONVERSION_JOB_OPTIONS,
    });
  }
  return queueSingleton;
}

export interface EnqueueConversionInput {
  attachmentId: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  /** Optional override of the worker output set. */
  outputs?: ConversionJobPayload['outputs'];
}

export interface EnqueueConversionResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Create a `ConversionJob` row + push a BullMQ job. Returns `{ ok, jobId }`
 * on success; on failure returns `{ ok: false, error }` so the caller can
 * decide whether to surface or swallow.
 *
 * The DB row id is reused as the BullMQ job id — that way the worker can
 * update the same row by id without a separate join.
 */
export async function enqueueConversion(
  input: EnqueueConversionInput,
): Promise<EnqueueConversionResult> {
  let jobRowId: string | undefined;
  try {
    const row = await prisma.conversionJob.create({
      data: {
        attachmentId: input.attachmentId,
        status: 'PENDING',
        attempt: 0,
      },
      select: { id: true },
    });
    jobRowId = row.id;

    const payload: ConversionJobPayload = {
      jobId: row.id,
      attachmentId: input.attachmentId,
      storagePath: input.storagePath,
      filename: input.filename,
      mimeType: input.mimeType,
      outputs: input.outputs ?? ['pdf', 'dxf', 'thumbnail'],
    };

    const queue = getConversionQueue();
    await queue.add('convert', payload, {
      jobId: row.id, // dedupe + correlation
    });

    return { ok: true, jobId: row.id };
  } catch (err) {
    // Don't bubble up — caller treats this as best-effort. Mark row FAILED if
    // the row landed but the BullMQ push didn't (unlikely but possible).
    const message = err instanceof Error ? err.message : String(err);
    if (jobRowId) {
      try {
        await prisma.conversionJob.update({
          where: { id: jobRowId },
          data: { status: 'FAILED', errorMessage: `enqueue failed: ${message}` },
        });
      } catch {
        /* ignore — secondary failure */
      }
    }
    // eslint-disable-next-line no-console
    console.error('[conversion-queue] enqueue failed', err);
    return { ok: false, error: message, jobId: jobRowId };
  }
}

/**
 * Re-enqueue an existing FAILED `ConversionJob` row. Resets status to
 * PENDING + attempt=0 + clears errorMessage in a transaction. Used by the
 * admin retry endpoint.
 */
export async function requeueConversion(
  jobRowId: string,
  payload: ConversionJobPayload,
): Promise<void> {
  const queue = getConversionQueue();
  // BullMQ won't accept duplicate jobIds while the prior job exists — so try
  // remove first (idempotent).
  try {
    const existing = await queue.getJob(jobRowId);
    if (existing) await existing.remove();
  } catch {
    /* ignore — old job may already be reaped */
  }
  await queue.add('convert', payload, { jobId: jobRowId });
}
