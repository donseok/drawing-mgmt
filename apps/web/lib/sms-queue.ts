// R38 / N-2 — SMS queue (BullMQ `sms`).
//
// `enqueueNotification` (lib/notifications.ts) writes the in-app row inside
// the transactional path that produced the event, then — after the
// transaction commits — pushes a job onto this queue when:
//   (a) `SMS_ENABLED=1` (env gate, see lib/sms.ts), AND
//   (b) the recipient's `User.notifyBySms` is true, AND
//   (c) the recipient has a populated `phoneNumber`.
//
// The worker (apps/worker/src/sms-worker.ts, owned by viewer-engineer)
// consumes jobs and calls `sendSms()` from lib/sms.ts (or its sibling).
// The Notification row is the source of truth — a transient SMS-provider
// failure just means BullMQ retries this job, not that the in-app feed is
// wrong.
//
// Mirrors lib/mail-queue.ts. Kept as a separate file (rather than fanned out
// inside one queue module) so the worker can mount each consumer
// independently and operators can pause one channel without affecting others.

import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { z } from 'zod';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Queue name. Mirrored on the worker side. Hard-coded `'sms'`; the
 * shared/conversion.ts can later expose `SMS_QUEUE_NAME` for symmetry with
 * the other queues (string-equal so that doesn't break the wire).
 */
export const SMS_QUEUE_NAME = 'sms';

/**
 * Payload schema. Forward-compatible with the eventual
 * `SmsJobPayloadSchema` in packages/shared. Field names are stable — the
 * worker reads exactly this shape.
 */
export const SmsJobPayloadSchema = z.object({
  /**
   * Optional Notification row id. Lets the worker correlate logs with the
   * in-app feed when investigating delivery failures. Not required because
   * `sendSms` is also useful for system-level texts (admin smoke tests, OTP).
   */
  notificationId: z.string().optional(),
  /**
   * Destination phone number. E.164-ish — drivers normalize before send.
   * Validated at the edge (lib/notifications.ts) so empty / null phones
   * never reach the queue.
   */
  to: z.string().min(3),
  /** Plain-text body (Korean SMS short-format ≤ 90 bytes). */
  text: z.string().min(1).max(2000),
});

export type SmsJobPayload = z.infer<typeof SmsJobPayloadSchema>;

/** Retry policy mirrored on the worker side (apps/worker/src/sms-worker.ts). */
export const SMS_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 60 * 60, count: 1_000 },
  removeOnFail: { age: 24 * 60 * 60, count: 1_000 },
};

let queueSingleton: Queue<SmsJobPayload> | null = null;
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

export function getSmsQueue(): Queue<SmsJobPayload> {
  if (!queueSingleton) {
    queueSingleton = new Queue<SmsJobPayload>(SMS_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: SMS_JOB_OPTIONS,
    });
  }
  return queueSingleton;
}

export interface EnqueueSmsResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Push a single SMS send onto the queue. Best-effort: callers should not
 * abort the parent operation when this fails. We log on error and surface
 * `{ ok: false, error }` so audit code can record it if it cares.
 *
 * Returns `{ ok: true, jobId }` on success. `jobId` is the BullMQ-assigned id
 * (auto-generated; not the Notification row id).
 */
export async function enqueueSms(
  payload: SmsJobPayload,
): Promise<EnqueueSmsResult> {
  const parsed = SmsJobPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid sms payload: ${parsed.error.message}`,
    };
  }
  try {
    const queue = getSmsQueue();
    const job = await queue.add('send', parsed.data);
    return { ok: true, jobId: job.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[sms-queue] enqueue failed', err);
    return { ok: false, error: message };
  }
}
