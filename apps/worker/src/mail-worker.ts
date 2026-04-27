/**
 * R35 N-1 — BullMQ worker for the `mail` queue.
 *
 * Consumes `MailJobPayload` jobs and runs nodemailer SMTP send via
 * `./mail.ts`. Failures throw so BullMQ honors the retry policy
 * (3 attempts + exponential backoff). Successful sends are logged only —
 * the originating Notification row (when present) is owned by the web
 * layer and was already created at enqueue time.
 *
 * Lifecycle:
 *   1. Job lands in `mail` queue (enqueued by web's enqueueNotification).
 *   2. Worker validates payload via MailJobPayloadSchema.
 *   3. Worker calls sendMail. On `MAIL_ENABLED!='1'` the call no-ops and
 *      returns SKIPPED — the worker still logs and returns success so the
 *      job is consumed (we don't want stale jobs piling up in dev).
 *   4. On SMTP error → throw → BullMQ retries.
 *
 * Why a separate worker file (vs inlining in index.ts):
 *   - Keeps the bootstrap matrix in index.ts compact and lets the mail
 *     worker be exported / tested in isolation.
 *   - Mirrors the pattern set by ./backup-worker.ts (R33).
 */

import { Worker, type Job } from 'bullmq';
import type { Redis as IORedis } from 'ioredis';
import type pino from 'pino';
import {
  MAIL_QUEUE_NAME,
  MailJobPayloadSchema,
  type MailJobPayload,
  type MailResult,
} from '@drawing-mgmt/shared/conversion';
import { sendMail } from './mail.js';

export interface MailWorkerHandle {
  worker: Worker<MailJobPayload, MailResult>;
  close: () => Promise<void>;
}

interface StartDeps {
  connection: IORedis;
  log: pino.Logger;
}

/**
 * Run a single mail job. Exported so unit tests can drive the handler with
 * a synthesized BullMQ Job<MailJobPayload> stub instead of standing up the
 * full Worker + Redis.
 */
export async function processMailJob(
  job: Job<MailJobPayload>,
  log: pino.Logger,
): Promise<MailResult> {
  const startedAt = Date.now();
  const payload = MailJobPayloadSchema.parse(job.data);
  const attemptNum = job.attemptsMade + 1;

  log.info(
    {
      notificationId: payload.notificationId,
      to: payload.to,
      subject: payload.subject,
      attempt: attemptNum,
    },
    'mail start',
  );

  try {
    const sendResult = await sendMail({
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });

    const result: MailResult = {
      notificationId: payload.notificationId,
      to: payload.to,
      status: sendResult.status === 'sent' ? 'SENT' : 'SKIPPED',
      messageId: sendResult.messageId,
      durationMs: Date.now() - startedAt,
    };
    log.info(result, 'mail done');
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
      'mail attempt failed',
    );
    // Always rethrow — BullMQ handles attempts/backoff per the queue's
    // job options (set by the enqueuer on the web side).
    throw err;
  }
}

/**
 * Start the BullMQ worker for the `mail` queue. Caller is responsible for
 * closing the returned handle on SIGTERM. Returns `null` when MAIL_ENABLED
 * is not '1' so the caller can skip wiring (but importantly, web-side
 * enqueues are also gated on MAIL_ENABLED so the queue stays empty).
 */
export function startMailWorker(deps: StartDeps): MailWorkerHandle | null {
  const { connection, log } = deps;

  if (process.env.MAIL_ENABLED !== '1') {
    log.info('mail worker disabled (MAIL_ENABLED!=1)');
    return null;
  }

  const worker = new Worker<MailJobPayload, MailResult>(
    MAIL_QUEUE_NAME,
    (job) => processMailJob(job, log),
    {
      connection,
      // SMTP is IO-bound + per-connection rate-limited on most providers.
      // A small concurrency keeps batch fan-outs (e.g. 50 approvers on a
      // bulk operation) orderly. Tunable via env for ops.
      concurrency: Number(process.env.MAIL_CONCURRENCY ?? 4),
    },
  );

  worker.on('completed', (_job, result) => {
    log.info(
      { to: result.to, durationMs: result.durationMs, status: result.status },
      'mail job completed',
    );
  });
  worker.on('failed', (job, err) => {
    log.error(
      { to: job?.data?.to, err: err.message },
      'mail job failed',
    );
  });

  log.info({ concurrency: process.env.MAIL_CONCURRENCY ?? 4 }, 'mail worker started');

  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}
