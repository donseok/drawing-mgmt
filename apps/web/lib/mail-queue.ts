// R35 / N-1 — Mail queue (BullMQ `mail`).
//
// `enqueueNotification` (lib/notifications.ts) writes the in-app row inside
// the transactional path that produced the event, then — after the
// transaction commits — pushes a job onto this queue when:
//   (a) MAIL_ENABLED=1 (env gate, see lib/mail.ts), AND
//   (b) the recipient's `User.notifyByEmail` is true.
//
// The worker (apps/worker/src/mail-worker.ts, owned by viewer-engineer)
// consumes jobs and calls `sendMail()` from lib/mail.ts (or its sibling).
// The Notification row is the source of truth — a transient SMTP failure
// just means BullMQ retries this job, not that the in-app feed is wrong.
//
// Lazy singleton: importing this module from a route does NOT open a Redis
// connection during build or static analysis.

import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { z } from 'zod';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Queue name. Mirrored on the worker side. Hard-coded `'mail'` matches the
 * shared/conversion.ts `MAIL_QUEUE_NAME` constant once viewer-engineer adds
 * it (string-equal, so the two sides stay compatible while the schema lands
 * in packages/shared).
 */
export const MAIL_QUEUE_NAME = 'mail';

/**
 * Payload schema. Defined here (rather than packages/shared) for now; the
 * shape is forward-compatible with the contract's eventual
 * `MailJobPayloadSchema`. Keep the field names stable — the worker will be
 * authored against this same shape.
 */
export const MailJobPayloadSchema = z.object({
  /**
   * Optional Notification row id. Lets the worker correlate logs with the
   * in-app feed when investigating delivery failures. Not required because
   * `sendMail` is also useful for system-level mails (admin smoke tests,
   * password reset, ...).
   */
  notificationId: z.string().optional(),
  /** RFC 5322 recipient. Single address — multi-recipient batching is out of scope for R35. */
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  /** Plain-text body. Required even when `html` is provided (RFC 8058 / accessibility). */
  text: z.string().min(1),
  /** Optional HTML alternative. */
  html: z.string().optional(),
});

export type MailJobPayload = z.infer<typeof MailJobPayloadSchema>;

/** Retry policy mirrored on the worker side (apps/worker/src/mail-worker.ts). */
export const MAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  // Hold completed/failed jobs briefly so admin/debug can inspect them.
  // Notification row is the long-term source of truth.
  removeOnComplete: { age: 60 * 60, count: 1_000 },
  removeOnFail: { age: 24 * 60 * 60, count: 1_000 },
};

let queueSingleton: Queue<MailJobPayload> | null = null;
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

export function getMailQueue(): Queue<MailJobPayload> {
  if (!queueSingleton) {
    queueSingleton = new Queue<MailJobPayload>(MAIL_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: MAIL_JOB_OPTIONS,
    });
  }
  return queueSingleton;
}

export interface EnqueueMailResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Push a single mail send onto the queue. Best-effort: callers should not
 * abort the parent operation when this fails. We log on error and surface
 * `{ ok: false, error }` so audit code can record it if it cares.
 *
 * Returns `{ ok: true, jobId }` on success. `jobId` is the BullMQ-assigned id
 * (auto-generated; not the Notification row id).
 */
export async function enqueueMail(
  payload: MailJobPayload,
): Promise<EnqueueMailResult> {
  const parsed = MailJobPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid mail payload: ${parsed.error.message}`,
    };
  }
  try {
    const queue = getMailQueue();
    const job = await queue.add('send', parsed.data);
    return { ok: true, jobId: job.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[mail-queue] enqueue failed', err);
    return { ok: false, error: message };
  }
}
