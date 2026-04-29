// R-AUDIT-TREND — Security audit queue handle (web side).
//
// Lazy singleton wrapper around the BullMQ `security-audit` queue, used by
// the SUPER_ADMIN-only `POST /api/v1/admin/security/audit/snapshot` route
// to push an ad-hoc job. The actual consumer
// (apps/worker/src/security-audit-worker.ts) runs in the worker process
// with its own connection — this module only opens a Redis socket on
// first call so cold starts / build steps don't pay for it.
//
// Same shape as `apps/web/lib/backup-queue.ts` (R33) — that module is the
// canonical reference for the lazy-singleton pattern. We mirror the env +
// connection options exactly so all admin queues fan out over a uniform
// socket configuration.
//
// FIND-016 mitigated: the worker reads the queue on `cron` (daily) AND on
// 'manual' admin pushes from this helper, both writing to the
// SecurityAuditSnapshot table for trend tracking.

import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import {
  SECURITY_AUDIT_QUEUE_NAME,
  type SecurityAuditJobPayload,
  type SecurityAuditResult,
} from '@drawing-mgmt/shared/conversion';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

let queueSingleton: Queue<SecurityAuditJobPayload, SecurityAuditResult> | null =
  null;
let connectionSingleton: Redis | null = null;

function getConnection(): Redis {
  if (!connectionSingleton) {
    connectionSingleton = new IORedis(REDIS_URL, {
      // BullMQ requires this for Worker; harmless for Queue-only callers.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connectionSingleton;
}

/**
 * Return the BullMQ Queue handle for the `security-audit` queue. Opens a
 * Redis connection on first call. The handle is process-singleton.
 */
export function getSecurityAuditQueue(): Queue<
  SecurityAuditJobPayload,
  SecurityAuditResult
> {
  if (!queueSingleton) {
    queueSingleton = new Queue<SecurityAuditJobPayload, SecurityAuditResult>(
      SECURITY_AUDIT_QUEUE_NAME,
      { connection: getConnection() },
    );
  }
  return queueSingleton;
}

export interface EnqueueAuditSnapshotResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Push an ad-hoc snapshot job onto the queue. Used by the admin POST
 * endpoint. The worker tags the resulting SecurityAuditSnapshot row with
 * `source='manual'` so trend queries filtering by `source='cron'` don't
 * pick it up as noise.
 *
 * Returns `{ ok, jobId }`. Failure to enqueue surfaces the error string
 * (admin route translates to E_INTERNAL).
 */
export async function enqueueManualAuditSnapshot(): Promise<EnqueueAuditSnapshotResult> {
  try {
    const queue = getSecurityAuditQueue();
    // Stable jobId per millisecond → BullMQ dedups if an admin double-clicks
    // within the same tick. The 1ms window is enough for human latency but
    // not so wide that two distinct admin actions collide.
    const jobId = `manual-${Date.now()}`;
    await queue.add(
      'manual-snapshot',
      { source: 'manual' },
      {
        jobId,
        attempts: 1,
        // Manual jobs are operator-curated; keep a short history so the
        // BullMQ dashboard stays readable.
        removeOnComplete: { age: 24 * 3600, count: 20 },
        removeOnFail: { age: 7 * 24 * 3600, count: 20 },
      },
    );
    return { ok: true, jobId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[security-audit-queue] enqueue manual snapshot failed', err);
    return { ok: false, error: message };
  }
}
