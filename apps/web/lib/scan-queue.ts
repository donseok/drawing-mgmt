// R36 / V-INF-3 — Virus scan queue (BullMQ `virus-scan`).
//
// Backend (apps/web) enqueues a job whenever an Attachment row is created in
// the upload hot paths:
//   - POST /api/v1/objects/{id}/attachments  (R21, single-shot upload)
//   - POST /api/v1/uploads/{id}/finalize     (R31, chunked upload finalize)
//
// The worker (apps/worker/src/scan-worker.ts, owned by viewer-engineer)
// consumes jobs and runs `clamscan` (or clamd TCP) on the source file. The
// Attachment row's `virusScanStatus` is the long-term source of truth — a
// transient queue/Redis hiccup just delays the scan; the row stays PENDING
// and another enqueue (manual rescan from /admin/scans) can resume.
//
// Lazy singleton: importing this module from a route does NOT open a Redis
// connection during build or static analysis. The `getScanQueue()` accessor
// constructs the BullMQ Queue on first use and reuses the same IORedis
// connection across enqueues.
//
// License posture: ClamAV (GPL) is invoked via subprocess only on the worker
// side — no JS bindings here. This file deals with the queue payload only.

import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import {
  VIRUS_SCAN_QUEUE_NAME,
  VirusScanJobPayloadSchema,
  type VirusScanJobPayload,
} from '@drawing-mgmt/shared/conversion';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Retry policy mirrored on the worker side. ClamAV failures are usually
 * transient (clamd restart, tmp file race) so 3 attempts with exponential
 * backoff is plenty before we land in FAILED + admin retry.
 */
export const VIRUS_SCAN_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  // Hold completed/failed jobs briefly so admin/debug can inspect them.
  // Attachment.virusScanStatus is the long-term source of truth.
  removeOnComplete: { age: 60 * 60, count: 1_000 },
  removeOnFail: { age: 24 * 60 * 60, count: 1_000 },
};

let queueSingleton: Queue<VirusScanJobPayload> | null = null;
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

export function getScanQueue(): Queue<VirusScanJobPayload> {
  if (!queueSingleton) {
    queueSingleton = new Queue<VirusScanJobPayload>(VIRUS_SCAN_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: VIRUS_SCAN_JOB_OPTIONS,
    });
  }
  return queueSingleton;
}

export interface EnqueueVirusScanInput {
  attachmentId: string;
  storagePath: string;
  filename: string;
  size?: number;
}

export interface EnqueueVirusScanResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Push a single scan job onto the queue. Best-effort: callers should NOT
 * abort the parent operation when this fails. We log on error and surface
 * `{ ok: false, error }` so the upload route can record the outcome in its
 * ActivityLog metadata without rolling back the upload itself.
 *
 * The Attachment row is created with `virusScanStatus = PENDING` (default),
 * so even if the enqueue silently drops the worker can still pick it up
 * later via the `/admin/scans/{id}/rescan` endpoint.
 *
 * Returns `{ ok: true, jobId }` on success. The `jobId` is the BullMQ
 * job id (we use the Attachment id so retries dedupe).
 */
export async function enqueueVirusScan(
  input: EnqueueVirusScanInput,
): Promise<EnqueueVirusScanResult> {
  const payload: VirusScanJobPayload = {
    attachmentId: input.attachmentId,
    storagePath: input.storagePath,
    filename: input.filename,
    ...(typeof input.size === 'number' ? { size: input.size } : {}),
  };
  const parsed = VirusScanJobPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid scan payload: ${parsed.error.message}`,
    };
  }
  try {
    const queue = getScanQueue();
    // Use the attachment id as the BullMQ job id so a duplicate enqueue
    // (e.g. an admin rescan that fires while the original is still pending)
    // is deduped instead of producing two parallel scans of the same file.
    const job = await queue.add('scan', parsed.data, {
      jobId: input.attachmentId,
    });
    return { ok: true, jobId: job.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[scan-queue] enqueue failed', err);
    return { ok: false, error: message };
  }
}

/**
 * Re-enqueue an existing scan job. Used by the admin rescan endpoint when
 * an attachment is in INFECTED/FAILED state and we want to retry. BullMQ
 * won't accept duplicate jobIds while the prior job exists — so we remove
 * the old one first (idempotent).
 */
export async function requeueVirusScan(
  input: EnqueueVirusScanInput,
): Promise<EnqueueVirusScanResult> {
  const queue = getScanQueue();
  try {
    const existing = await queue.getJob(input.attachmentId);
    if (existing) await existing.remove();
  } catch {
    /* ignore — old job may already be reaped */
  }
  return enqueueVirusScan(input);
}
