/**
 * R38 N-2 — BullMQ worker for the `kakao` queue.
 *
 * Same shape as `./sms-worker.ts` and `./mail-worker.ts`. The `kakao`
 * queue is independent of `sms` so a Bizmessage provider outage doesn't
 * stall SMS retries (and vice versa). Each channel pays its own retry
 * budget.
 *
 * Lifecycle:
 *   1. Job enqueued by web's notification fan-out when the target user
 *      has `notifyByKakao=true` AND phoneNumber set AND KAKAO_ENABLED=1.
 *   2. Worker validates payload via `KakaoJobPayloadSchema`.
 *   3. Worker calls `sendKakao`. SKIPPED when KAKAO_ENABLED!='1' or
 *      no driver — still treated as success so the job consumes.
 *   4. On provider error → throw → BullMQ retries.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis as IORedis } from 'ioredis';
import type pino from 'pino';
import {
  KAKAO_QUEUE_NAME,
  KakaoJobPayloadSchema,
  type KakaoJobPayload,
  type KakaoResult,
} from '@drawing-mgmt/shared/conversion';
import { sendKakao } from './kakao.js';

export interface KakaoWorkerHandle {
  worker: Worker<KakaoJobPayload, KakaoResult>;
  close: () => Promise<void>;
}

interface StartDeps {
  connection: IORedis;
  log: pino.Logger;
}

/**
 * Run a single Kakao job. Exported for unit tests to drive in
 * isolation without standing up Redis.
 */
export async function processKakaoJob(
  job: Job<KakaoJobPayload>,
  log: pino.Logger,
): Promise<KakaoResult> {
  const startedAt = Date.now();
  const payload = KakaoJobPayloadSchema.parse(job.data);
  const attemptNum = job.attemptsMade + 1;

  log.info(
    {
      notificationId: payload.notificationId,
      to: payload.to,
      templateCode: payload.templateCode,
      attempt: attemptNum,
    },
    'kakao start',
  );

  try {
    const sendResult = await sendKakao({
      to: payload.to,
      templateCode: payload.templateCode,
      variables: payload.variables,
    });

    const result: KakaoResult = {
      notificationId: payload.notificationId,
      to: payload.to,
      status: sendResult.status === 'sent' ? 'SENT' : 'SKIPPED',
      providerId: sendResult.providerId,
      durationMs: Date.now() - startedAt,
    };
    log.info(result, 'kakao done');
    return result;
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const isLastAttempt = attemptNum >= (job.opts.attempts ?? 1);
    log.error(
      {
        notificationId: payload.notificationId,
        to: payload.to,
        templateCode: payload.templateCode,
        attempt: attemptNum,
        isLastAttempt,
        err: errMessage,
      },
      'kakao attempt failed',
    );
    throw err;
  }
}

/**
 * Start the BullMQ worker for the `kakao` queue. Returns `null` when
 * KAKAO_ENABLED!='1' (matches the web-side gate).
 */
export function startKakaoWorker(deps: StartDeps): KakaoWorkerHandle | null {
  const { connection, log } = deps;

  if (process.env.KAKAO_ENABLED !== '1') {
    log.info('kakao worker disabled (KAKAO_ENABLED!=1)');
    return null;
  }

  const worker = new Worker<KakaoJobPayload, KakaoResult>(
    KAKAO_QUEUE_NAME,
    (job) => processKakaoJob(job, log),
    {
      connection,
      // Bizmessage providers throttle per-sender-key (typical 100/sec
      // ceiling) but our actual hot path is a single approval fan-out
      // of ≤50 recipients. Default 2 keeps us well under any provider
      // floor; tunable via env.
      concurrency: Number(process.env.KAKAO_CONCURRENCY ?? 2),
    },
  );

  worker.on('completed', (_job, result) => {
    log.info(
      { to: result.to, durationMs: result.durationMs, status: result.status },
      'kakao job completed',
    );
  });
  worker.on('failed', (job, err) => {
    log.error(
      { to: job?.data?.to, err: err.message },
      'kakao job failed',
    );
  });

  log.info(
    {
      concurrency: process.env.KAKAO_CONCURRENCY ?? 2,
      driver: process.env.KAKAO_DRIVER ?? '(none)',
    },
    'kakao worker started',
  );

  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}
