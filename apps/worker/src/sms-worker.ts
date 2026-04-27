/**
 * R38 N-2 — BullMQ worker for the `sms` queue.
 *
 * Direct mirror of R35's mail-worker.ts, swapping the SMTP send for
 * the SMS driver in `./sms.ts`. The same lifecycle rules apply:
 *
 *   1. Job lands in `sms` queue (enqueued by web's notification fan-out
 *      when `notifyBySms=true` AND phoneNumber set AND SMS_ENABLED=1).
 *   2. Worker validates payload via `SmsJobPayloadSchema`.
 *   3. Worker calls `sendSms`. On `SMS_ENABLED!='1'` (or no driver) the
 *      call no-ops and returns SKIPPED — we still log + return success
 *      so the job is consumed (no stale buildup in dev/CI).
 *   4. On provider error → throw → BullMQ retries (3 attempts +
 *      exp backoff, owned by the enqueuer's job options).
 *
 * Why `null` from `startSmsWorker` when disabled (mirroring mail):
 * lets `index.ts` keep its bootstrap matrix branch-free — wire the
 * handle when present, no-op the close in shutdown otherwise.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis as IORedis } from 'ioredis';
import type pino from 'pino';
import {
  SMS_QUEUE_NAME,
  SmsJobPayloadSchema,
  type SmsJobPayload,
  type SmsResult,
} from '@drawing-mgmt/shared/conversion';
import { sendSms } from './sms.js';

export interface SmsWorkerHandle {
  worker: Worker<SmsJobPayload, SmsResult>;
  close: () => Promise<void>;
}

interface StartDeps {
  connection: IORedis;
  log: pino.Logger;
}

/**
 * Run a single SMS job. Exported so unit tests can drive the handler
 * with a synthesized BullMQ Job<SmsJobPayload> stub instead of standing
 * up the full Worker + Redis.
 */
export async function processSmsJob(
  job: Job<SmsJobPayload>,
  log: pino.Logger,
): Promise<SmsResult> {
  const startedAt = Date.now();
  const payload = SmsJobPayloadSchema.parse(job.data);
  const attemptNum = job.attemptsMade + 1;

  log.info(
    {
      notificationId: payload.notificationId,
      to: payload.to,
      attempt: attemptNum,
    },
    'sms start',
  );

  try {
    const sendResult = await sendSms({
      to: payload.to,
      text: payload.text,
    });

    const result: SmsResult = {
      notificationId: payload.notificationId,
      to: payload.to,
      status: sendResult.status === 'sent' ? 'SENT' : 'SKIPPED',
      providerId: sendResult.providerId,
      durationMs: Date.now() - startedAt,
    };
    log.info(result, 'sms done');
    return result;
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const isLastAttempt = attemptNum >= (job.opts.attempts ?? 1);
    log.error(
      {
        notificationId: payload.notificationId,
        to: payload.to,
        attempt: attemptNum,
        isLastAttempt,
        err: errMessage,
      },
      'sms attempt failed',
    );
    // Always rethrow — BullMQ handles attempts/backoff per the queue's
    // job options (set by the enqueuer on the web side).
    throw err;
  }
}

/**
 * Start the BullMQ worker for the `sms` queue. Returns `null` when
 * SMS_ENABLED!='1' so the caller can skip wiring (and importantly,
 * web-side enqueues are also gated on SMS_ENABLED so the queue stays
 * empty in dev/CI).
 */
export function startSmsWorker(deps: StartDeps): SmsWorkerHandle | null {
  const { connection, log } = deps;

  if (process.env.SMS_ENABLED !== '1') {
    log.info('sms worker disabled (SMS_ENABLED!=1)');
    return null;
  }

  const worker = new Worker<SmsJobPayload, SmsResult>(
    SMS_QUEUE_NAME,
    (job) => processSmsJob(job, log),
    {
      connection,
      // SMS APIs are aggressively rate-limited (Twilio default 1
      // msg/sec/sender). Keep concurrency conservative so a 50-recipient
      // bulk approval fan-out doesn't trip the provider's throttle.
      // Tunable via env for ops.
      concurrency: Number(process.env.SMS_CONCURRENCY ?? 2),
    },
  );

  worker.on('completed', (_job, result) => {
    log.info(
      { to: result.to, durationMs: result.durationMs, status: result.status },
      'sms job completed',
    );
  });
  worker.on('failed', (job, err) => {
    log.error(
      { to: job?.data?.to, err: err.message },
      'sms job failed',
    );
  });

  log.info(
    {
      concurrency: process.env.SMS_CONCURRENCY ?? 2,
      driver: process.env.SMS_DRIVER ?? '(none)',
    },
    'sms worker started',
  );

  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}
