// Backup queue helper — wraps the BullMQ `backup` queue + Backup row INSERT.
//
// R33 / D-5. Web side: the admin "지금 실행" endpoint enqueues a job here and
// `apps/worker` consumes it (running pg_dump or tarring FILE_STORAGE_ROOT).
// The Backup row is the long-term source of truth; BullMQ is just transport.
//
// Lazy singleton: the Queue is constructed on first use because importing
// this module from a route should not open a Redis connection during build
// or static analysis.
//
// We share Redis via `getConnection()` from conversion-queue.ts so a single
// IORedis socket fans out across all admin queues in this process.

import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { BackupKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const BACKUP_QUEUE_NAME = 'backup';

/** Payload pushed onto the BullMQ `backup` queue. */
export interface BackupJobPayload {
  /** Backup row id — reused as the BullMQ jobId. */
  jobId: string;
  kind: BackupKind;
}

/** Retry policy mirrored on the worker side. */
export const BACKUP_JOB_OPTIONS: JobsOptions = {
  // Backups are expensive — let the worker fail loudly rather than silently
  // retrying a half-broken pg_dump three times.
  attempts: 1,
  removeOnComplete: { age: 60 * 60, count: 200 },
  removeOnFail: { age: 24 * 60 * 60, count: 200 },
};

let queueSingleton: Queue<BackupJobPayload> | null = null;
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

export function getBackupQueue(): Queue<BackupJobPayload> {
  if (!queueSingleton) {
    queueSingleton = new Queue<BackupJobPayload>(BACKUP_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: BACKUP_JOB_OPTIONS,
    });
  }
  return queueSingleton;
}

export interface EnqueueBackupResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Create a `Backup` row (RUNNING) + push a BullMQ job. Returns
 * `{ ok, jobId }` on success; on failure the row is flipped to FAILED so
 * the admin UI surfaces what happened.
 *
 * The DB row id is reused as the BullMQ job id so the worker can update the
 * same row by id without an extra lookup.
 */
export async function enqueueBackup(
  kind: BackupKind,
): Promise<EnqueueBackupResult> {
  let rowId: string | undefined;
  try {
    const row = await prisma.backup.create({
      data: { kind, status: 'RUNNING' },
      select: { id: true },
    });
    rowId = row.id;

    const payload: BackupJobPayload = { jobId: row.id, kind };
    const queue = getBackupQueue();
    await queue.add('run-backup', payload, { jobId: row.id });

    return { ok: true, jobId: row.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (rowId) {
      try {
        await prisma.backup.update({
          where: { id: rowId },
          data: {
            status: 'FAILED',
            errorMessage: `enqueue failed: ${message}`,
            finishedAt: new Date(),
          },
        });
      } catch {
        /* ignore — secondary failure */
      }
    }
    // eslint-disable-next-line no-console
    console.error('[backup-queue] enqueue failed', err);
    return { ok: false, error: message, jobId: rowId };
  }
}
