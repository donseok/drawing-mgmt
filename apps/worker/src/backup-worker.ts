/**
 * R33 D-5 — BullMQ worker for the `backup` queue.
 *
 * Consumes `BackupJobPayload` jobs and writes archives via `./backup.ts`.
 * Lifecycle on the corresponding `Backup` row (schema owned by backend):
 *
 *   PENDING (set by enqueuer)
 *     → RUNNING  (set on entry; bumps `attempt`, sets `startedAt`)
 *       → DONE   (on success; sets `finishedAt`, `storagePath`, `sizeBytes`)
 *       OR
 *       → FAILED (final attempt only; intermediate retries keep RUNNING +
 *                  fresh `errorMessage` so admins can spot in-flight retries)
 *
 * Why a typed-loose Prisma access:
 *   The `Backup` model is added by backend in their slice of R33. To avoid a
 *   build-time coupling — and to keep this PR shippable independently — we
 *   call `prisma.backup` through a narrow structural type (`BackupModelOps`).
 *   Once backend lands the schema migration the runtime call shape matches
 *   what Prisma generates and no further changes are needed here.
 *
 * Daily cron:
 *   `BACKUP_CRON_ENABLED=1` enrolls two repeatable jobs (POSTGRES + FILES)
 *   on `BACKUP_CRON_PATTERN` (default 02:00 UTC daily). Repeatable jobs
 *   require a `Backup` row per occurrence — but we don't have row creation
 *   privileges from the worker side. Instead the cron jobs we enqueue here
 *   carry `backupId: ''` and the worker creates the row on RUN if missing
 *   (via the same loose Prisma surface). That keeps backend in charge of the
 *   model + endpoints while letting the worker schedule itself.
 */

import { Queue, Worker, type Job } from 'bullmq';
import type { Redis as IORedis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import path from 'node:path';
import {
  BACKUP_QUEUE_NAME,
  BackupJobPayloadSchema,
  type BackupJobPayload,
  type BackupResult,
} from '@drawing-mgmt/shared/conversion';
import {
  pruneOldBackups,
  prefixFor,
  runFileStorageBackup,
  runPostgresBackup,
} from './backup.js';
import { getStorage } from './storage.js';

// ─── env ────────────────────────────────────────────────────────────────────

const BACKUP_ROOT = path.resolve(process.env.BACKUP_ROOT ?? './.data/backups');
const BACKUP_RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
const BACKUP_CRON_ENABLED = process.env.BACKUP_CRON_ENABLED === '1';
const BACKUP_CRON_PATTERN = process.env.BACKUP_CRON_PATTERN ?? '0 2 * * *';

// ─── Backup row Prisma surface (loose-typed) ────────────────────────────────
//
// We only depend on the columns we read/write. Backend's schema may include
// more (e.g. `retentionDays`, `triggeredBy`); those are ignored here.

type BackupStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

interface BackupRow {
  id: string;
  kind: 'POSTGRES' | 'FILES';
  status?: BackupStatus;
  attempt?: number;
  storagePath?: string | null;
  sizeBytes?: number | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  errorMessage?: string | null;
}

interface BackupModelOps {
  findUnique(args: { where: { id: string } }): Promise<BackupRow | null>;
  create(args: { data: Partial<BackupRow> & { kind: BackupRow['kind'] } }): Promise<BackupRow>;
  update(args: {
    where: { id: string };
    data: Partial<BackupRow>;
  }): Promise<BackupRow>;
}

function backupModel(prisma: PrismaClient): BackupModelOps {
  // The Prisma client exposes models by lowercase model name. When backend
  // adds `model Backup` the property `prisma.backup` becomes the typed
  // delegate; until then the runtime call would error and surface as a job
  // failure, which is the correct behavior (the worker shouldn't silently
  // succeed if there's no row to update).
  const dyn = prisma as unknown as { backup?: BackupModelOps };
  if (!dyn.backup) {
    throw new Error(
      'prisma.backup is not available — backend Backup model migration not yet applied',
    );
  }
  return dyn.backup;
}

// ─── job handler ────────────────────────────────────────────────────────────

interface ProcessDeps {
  prisma: PrismaClient;
  log: pino.Logger;
}

/**
 * Run a single backup job. Exported for tests; production wires this into
 * the BullMQ Worker via `startBackupWorker`.
 */
export async function processBackupJob(
  job: Job<BackupJobPayload>,
  deps: ProcessDeps,
): Promise<BackupResult> {
  const startedAt = Date.now();
  const payload = BackupJobPayloadSchema.parse(job.data);
  const attemptNum = job.attemptsMade + 1;
  const { prisma, log } = deps;

  log.info(
    { backupId: payload.backupId, kind: payload.kind, attempt: attemptNum },
    'backup start',
  );

  // For cron-triggered jobs `backupId === ''` — create the row on first
  // touch so backend doesn't need a separate scheduler. For normal API-
  // triggered jobs the row already exists; we just look it up to confirm.
  let backupId = payload.backupId;
  const ops = backupModel(prisma);
  if (!backupId) {
    const created = await ops.create({
      data: {
        kind: payload.kind,
        status: 'PENDING',
        attempt: 0,
      },
    });
    backupId = created.id;
    log.info({ backupId, kind: payload.kind }, 'backup row auto-created (cron)');
  }

  await ops
    .update({
      where: { id: backupId },
      data: {
        status: 'RUNNING',
        attempt: attemptNum,
        startedAt: new Date(),
        errorMessage: null,
      },
    })
    .catch((e) => {
      log.warn(
        { backupId, err: (e as Error).message },
        'backup row update (RUNNING) failed',
      );
    });

  try {
    // FILES backup goes through the storage abstraction (R34 V-INF-1) so it
    // archives both Local and S3 driver layouts uniformly. The worker's
    // storage singleton is shared with the conversion pipeline.
    const artifact =
      payload.kind === 'POSTGRES'
        ? await runPostgresBackup({ outDir: BACKUP_ROOT })
        : await runFileStorageBackup({
            storage: getStorage(),
            outDir: BACKUP_ROOT,
            log: (msg, meta) => log.info({ ...meta, backupId }, msg),
          });

    const days = payload.retentionDaysOverride ?? BACKUP_RETENTION_DAYS;
    const prunedCount = await pruneOldBackups(
      BACKUP_ROOT,
      days,
      prefixFor(payload.kind),
      (msg, meta) => log.warn({ ...meta, backupId }, msg),
    ).catch((err) => {
      // Pruning is best-effort; never let it fail the job.
      log.warn(
        { backupId, err: (err as Error).message },
        'prune old backups failed',
      );
      return 0;
    });

    await ops
      .update({
        where: { id: backupId },
        data: {
          status: 'DONE',
          finishedAt: new Date(),
          storagePath: artifact.storagePath,
          sizeBytes: artifact.sizeBytes,
          errorMessage: null,
        },
      })
      .catch((e) => {
        log.warn(
          { backupId, err: (e as Error).message },
          'backup row update (DONE) failed',
        );
      });

    const result: BackupResult = {
      backupId,
      kind: payload.kind,
      status: 'DONE',
      storagePath: artifact.storagePath,
      sizeBytes: artifact.sizeBytes,
      prunedCount,
      durationMs: Date.now() - startedAt,
    };
    log.info(result, 'backup done');
    return result;
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const isLastAttempt = attemptNum >= (job.opts.attempts ?? 1);

    await ops
      .update({
        where: { id: backupId },
        data: isLastAttempt
          ? {
              status: 'FAILED',
              errorMessage: errMessage,
              finishedAt: new Date(),
            }
          : {
              status: 'RUNNING',
              errorMessage: errMessage,
            },
      })
      .catch((updateErr) => {
        log.warn(
          { backupId, err: (updateErr as Error).message },
          'backup row update (FAILED/RUNNING) failed',
        );
      });

    log.error(
      { backupId, attempt: attemptNum, isLastAttempt, err: errMessage },
      'backup attempt failed',
    );
    throw err;
  }
}

// ─── worker bootstrap ───────────────────────────────────────────────────────

export interface BackupWorkerHandle {
  worker: Worker<BackupJobPayload, BackupResult>;
  queue: Queue<BackupJobPayload, BackupResult>;
  close: () => Promise<void>;
}

/**
 * Start the BullMQ worker for the `backup` queue, register cron repeatables
 * if enabled, and return a handle the caller can close on SIGTERM.
 */
export function startBackupWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  log: pino.Logger;
}): BackupWorkerHandle {
  const { connection, prisma, log } = deps;

  const worker = new Worker<BackupJobPayload, BackupResult>(
    BACKUP_QUEUE_NAME,
    (job) => processBackupJob(job, { prisma, log }),
    {
      connection,
      // Backups are heavy + IO-bound. Run sequentially to avoid starving the
      // DWG conversion workers and to keep pg_dump from competing with itself.
      concurrency: Number(process.env.BACKUP_CONCURRENCY ?? 1),
    },
  );

  worker.on('completed', (_job, result) => {
    log.info(
      { backupId: result.backupId, durationMs: result.durationMs },
      'backup job completed',
    );
  });
  worker.on('failed', (job, err) => {
    log.error(
      { backupId: job?.data?.backupId, err: err.message },
      'backup failed',
    );
  });

  // Queue handle is needed only to schedule repeatables. We construct it on
  // the same connection so close() in shutdown is symmetric.
  const queue = new Queue<BackupJobPayload, BackupResult>(
    BACKUP_QUEUE_NAME,
    { connection },
  );

  if (BACKUP_CRON_ENABLED) {
    // `backupId: ''` signals the worker to auto-create the Backup row at run
    // time. Each repeat occurrence enqueues a fresh job — BullMQ dedupes by
    // jobId pattern so we don't need an explicit clean step on restart.
    queue
      .add(
        'cron-postgres',
        { backupId: '', kind: 'POSTGRES' },
        {
          repeat: { pattern: BACKUP_CRON_PATTERN },
          jobId: 'cron-postgres',
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { age: 7 * 24 * 3600, count: 100 },
          removeOnFail: { age: 30 * 24 * 3600, count: 200 },
        },
      )
      .catch((e) =>
        log.warn(
          { err: (e as Error).message },
          'register cron-postgres failed',
        ),
      );
    queue
      .add(
        'cron-files',
        { backupId: '', kind: 'FILES' },
        {
          repeat: { pattern: BACKUP_CRON_PATTERN },
          jobId: 'cron-files',
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { age: 7 * 24 * 3600, count: 100 },
          removeOnFail: { age: 30 * 24 * 3600, count: 200 },
        },
      )
      .catch((e) =>
        log.warn(
          { err: (e as Error).message },
          'register cron-files failed',
        ),
      );
    log.info(
      { pattern: BACKUP_CRON_PATTERN, root: BACKUP_ROOT },
      'backup cron enabled',
    );
  } else {
    log.info(
      { root: BACKUP_ROOT, retentionDays: BACKUP_RETENTION_DAYS },
      'backup worker started (cron disabled)',
    );
  }

  return {
    worker,
    queue,
    close: async () => {
      await Promise.all([worker.close(), queue.close()]);
    },
  };
}
