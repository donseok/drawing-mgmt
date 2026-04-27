// R38 / N-2 — KakaoTalk 알림톡 queue (BullMQ `kakao`).
//
// `enqueueNotification` pushes a job here when:
//   (a) `KAKAO_ENABLED=1` (env gate, see lib/kakao.ts), AND
//   (b) the recipient's `User.notifyByKakao` is true, AND
//   (c) the recipient has a populated `phoneNumber`.
//
// The worker (apps/worker/src/kakao-worker.ts, owned by viewer-engineer)
// consumes jobs and calls `sendKakao()` from lib/kakao.ts (or its sibling).
// The Notification row is the source of truth — a transient provider failure
// just means BullMQ retries this job.
//
// Mirrors lib/sms-queue.ts. Kept separate (rather than a shared
// "push-channel" queue) so operators can pause one channel without affecting
// the other.

import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { z } from 'zod';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Queue name. Mirrored on the worker side. Hard-coded `'kakao'`; the shared
 * package can later expose `KAKAO_QUEUE_NAME` for symmetry with the other
 * queues (string-equal so that's a no-op rename when it lands).
 */
export const KAKAO_QUEUE_NAME = 'kakao';

/**
 * Payload schema. Stable shape that the worker mirrors. Variables are sent
 * as a string→string map; values are coerced to strings at the edge so the
 * provider never sees `null` / numbers.
 */
export const KakaoJobPayloadSchema = z.object({
  notificationId: z.string().optional(),
  /** Destination phone number. E.164-ish; drivers normalize before send. */
  to: z.string().min(3),
  /**
   * Pre-approved BizMessage template code. Required — Kakao rejects
   * free-form text. Validated by sendKakao() too, but we also reject early
   * here so a misshapen enqueue never reaches the worker.
   */
  templateCode: z.string().min(1),
  /**
   * Variable map (`{name}` placeholders inside the template body). Values
   * coerced to strings so BullMQ JSON serialization is stable.
   */
  variables: z.record(z.string(), z.string()).default({}),
});

export type KakaoJobPayload = z.infer<typeof KakaoJobPayloadSchema>;

/** Retry policy mirrored on the worker side (apps/worker/src/kakao-worker.ts). */
export const KAKAO_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 60 * 60, count: 1_000 },
  removeOnFail: { age: 24 * 60 * 60, count: 1_000 },
};

let queueSingleton: Queue<KakaoJobPayload> | null = null;
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

export function getKakaoQueue(): Queue<KakaoJobPayload> {
  if (!queueSingleton) {
    queueSingleton = new Queue<KakaoJobPayload>(KAKAO_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: KAKAO_JOB_OPTIONS,
    });
  }
  return queueSingleton;
}

export interface EnqueueKakaoResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Push a single 알림톡 send onto the queue. Best-effort — failures are
 * logged and surfaced as `{ ok: false, error }` but never thrown. The
 * caller (typically `enqueueNotification`) treats this as fire-and-forget.
 */
export async function enqueueKakao(
  payload: KakaoJobPayload,
): Promise<EnqueueKakaoResult> {
  const parsed = KakaoJobPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid kakao payload: ${parsed.error.message}`,
    };
  }
  try {
    const queue = getKakaoQueue();
    const job = await queue.add('send', parsed.data);
    return { ok: true, jobId: job.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[kakao-queue] enqueue failed', err);
    return { ok: false, error: message };
  }
}
