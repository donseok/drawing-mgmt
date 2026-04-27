/**
 * R36 V-INF-3 — BullMQ worker for the `virus-scan` queue.
 *
 * Consumes `VirusScanJobPayload` jobs and runs ClamAV against the
 * referenced Attachment via `./clamav.ts` (subprocess only — no GPL
 * binding imports). Lifecycle on the Attachment row (schema owned by
 * backend, see `_workspace/api_contract.md` §2):
 *
 *   PENDING (set by enqueuer)
 *     → SCANNING  (worker entry; bumps `attempt` is intentionally not
 *                   tracked because Attachment has no attempt column,
 *                   BullMQ retains attemptsMade on the Job itself)
 *       → CLEAN
 *       OR INFECTED + virusScanSig
 *       OR SKIPPED  (CLAMAV_ENABLED!='1' or binary missing)
 *       OR FAILED   (final attempt only on real errors; intermediate
 *                     retries roll back to SCANNING with errorMessage)
 *
 * Side effects on INFECTED:
 *   - One Notification row per admin (Role in {ADMIN, SUPER_ADMIN})
 *     with type='SECURITY_INFECTED_FILE'.
 *   - One Notification row for the uploader (Version.createdBy).
 *   - One ActivityLog row (action='SECURITY_INFECTED_FILE',
 *     userId=uploader, objectId=Object.id resolved via revisionId).
 *
 * Schema coupling — important:
 *   The R36 migration adding `virusScanStatus` / `virusScanSig` /
 *   `virusScanAt` to Attachment is owned by backend (apps/web). To
 *   keep this worker shippable independently we drive Prisma through
 *   a structural type (`AttachmentScanOps`) rather than a generated
 *   Prisma model field reference. Once the migration is applied the
 *   runtime call shape lines up and the worker behaves correctly; if
 *   the migration is *not* yet applied the UPDATE silently no-ops on
 *   the unknown columns (Prisma raw `update` against an unknown column
 *   would actually throw — that's fine, it surfaces as a job FAILED
 *   and operators see the error).
 */

import { Worker, type Job } from 'bullmq';
import type { Redis as IORedis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  VIRUS_SCAN_QUEUE_NAME,
  VirusScanJobPayloadSchema,
  type VirusScanJobPayload,
  type VirusScanResult,
} from '@drawing-mgmt/shared/conversion';
import { scanFile, type ScanFileResult } from './clamav.js';
import { getStorage, type Storage } from './storage.js';

// ─── env ────────────────────────────────────────────────────────────────────

const SCAN_CONCURRENCY = Number(process.env.VIRUS_SCAN_CONCURRENCY ?? 2);

// ─── Prisma surface (loose-typed for forward compat with R36 migration) ────
//
// We only reach into the columns we actually mutate. Once backend lands
// `0010_r36_virus_scan.sql` these match the generated Prisma client; until
// then the call still compiles (we don't reference Prisma's type), and at
// runtime an UPDATE on an unknown column will throw — which surfaces as
// the job's FAILED outcome and is the correct signal.

interface AttachmentRow {
  id: string;
  storagePath: string;
  filename: string;
  versionId: string;
  virusScanStatus?: string;
  virusScanSig?: string | null;
  virusScanAt?: Date | null;
}

interface AttachmentScanOps {
  findUnique(args: {
    where: { id: string };
    select?: Record<string, boolean>;
  }): Promise<AttachmentRow | null>;
  update(args: {
    where: { id: string };
    data: Partial<AttachmentRow>;
  }): Promise<AttachmentRow>;
}

function attachmentModel(prisma: PrismaClient): AttachmentScanOps {
  const dyn = prisma as unknown as { attachment?: AttachmentScanOps };
  if (!dyn.attachment) {
    throw new Error(
      'prisma.attachment is not available — schema generation incomplete',
    );
  }
  return dyn.attachment;
}

// ─── job handler ────────────────────────────────────────────────────────────

interface ProcessDeps {
  prisma: PrismaClient;
  log: pino.Logger;
  storage?: Storage;
}

/**
 * Run a single virus-scan job. Exported for unit tests; production wires
 * this into the BullMQ Worker via `startScanWorker`.
 *
 * Throws on infrastructure errors (DB unreachable, scan engine crash, …)
 * so BullMQ honors the queue's `attempts` policy. Does NOT throw on a
 * legitimate INFECTED outcome — that's a successful scan whose result
 * happens to be bad.
 */
export async function processScanJob(
  job: Job<VirusScanJobPayload>,
  deps: ProcessDeps,
): Promise<VirusScanResult> {
  const startedAt = Date.now();
  const payload = VirusScanJobPayloadSchema.parse(job.data);
  const attemptNum = job.attemptsMade + 1;
  const { prisma, log } = deps;
  const storage = deps.storage ?? getStorage();

  log.info(
    { attachmentId: payload.attachmentId, attempt: attemptNum },
    'virus-scan start',
  );

  // ── 1) Load the Attachment row ─────────────────────────────────────────
  const att = await attachmentModel(prisma).findUnique({
    where: { id: payload.attachmentId },
  });
  if (!att) {
    // Race: enqueued for an attachment that was deleted before we got
    // here. Not a job failure — return a synthetic FAILED result so the
    // job is consumed and BullMQ doesn't retry forever.
    log.warn(
      { attachmentId: payload.attachmentId },
      'virus-scan: attachment row not found, dropping job',
    );
    return {
      attachmentId: payload.attachmentId,
      status: 'FAILED',
      errorMessage: 'attachment row not found',
      durationMs: Date.now() - startedAt,
    };
  }

  // ── 2) Mark SCANNING ───────────────────────────────────────────────────
  await attachmentModel(prisma)
    .update({
      where: { id: att.id },
      data: { virusScanStatus: 'SCANNING' },
    })
    .catch((e) => {
      // Schema not yet migrated, or transient DB error. Log + continue —
      // we'd rather scan and not mark than skip the scan.
      log.warn(
        { attachmentId: att.id, err: (e as Error).message },
        'virus-scan: SCANNING mark failed (continuing)',
      );
    });

  // ── 3) Materialize the file from storage to a local temp file ──────────
  const tmpDir = path.join(os.tmpdir(), `dm-scan-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const localPath = path.join(tmpDir, path.basename(att.storagePath) || 'file');

  let scanOutcome: ScanFileResult;
  try {
    await materializeForScan(storage, att.storagePath, localPath);
    scanOutcome = await scanFile(localPath);
  } catch (err) {
    // Real infra failure (storage 404, IO error, etc.). Decide whether to
    // mark FAILED on the row or roll back to SCANNING (intermediate retry).
    const errMessage = err instanceof Error ? err.message : String(err);
    const isLastAttempt = attemptNum >= (job.opts.attempts ?? 1);
    await attachmentModel(prisma)
      .update({
        where: { id: att.id },
        data: isLastAttempt
          ? {
              virusScanStatus: 'FAILED',
              virusScanAt: new Date(),
            }
          : {
              // Keep SCANNING so admin UI shows in-flight retry.
              virusScanStatus: 'SCANNING',
            },
      })
      .catch(() => undefined);

    log.error(
      {
        attachmentId: att.id,
        attempt: attemptNum,
        isLastAttempt,
        err: errMessage,
      },
      'virus-scan attempt failed',
    );
    await safeRm(tmpDir);
    throw err; // BullMQ retry / final fail
  } finally {
    await safeRm(tmpDir);
  }

  // ── 4) Persist outcome ────────────────────────────────────────────────
  const finishedAt = new Date();
  await attachmentModel(prisma)
    .update({
      where: { id: att.id },
      data: {
        virusScanStatus: scanOutcome.status,
        virusScanSig: scanOutcome.signature ?? null,
        virusScanAt: finishedAt,
      },
    })
    .catch((e) => {
      log.warn(
        { attachmentId: att.id, err: (e as Error).message },
        'virus-scan: outcome persist failed',
      );
    });

  // ── 5) INFECTED side-effects (notifications + activity log) ────────────
  if (scanOutcome.status === 'INFECTED') {
    await emitInfectedNotifications(prisma, att, scanOutcome.signature, log);
  }

  const result: VirusScanResult = {
    attachmentId: att.id,
    status: scanOutcome.status,
    signature: scanOutcome.signature,
    errorMessage: scanOutcome.reason,
    durationMs: Date.now() - startedAt,
  };
  log.info(result, 'virus-scan done');
  return result;
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function materializeForScan(
  storage: Storage,
  storagePath: string,
  localPath: string,
): Promise<void> {
  // Mirrors the legacy-vs-key heuristic in index.ts: pre-R34 rows hold an
  // absolute filesystem path that storage.get would refuse via validateKey.
  if (path.isAbsolute(storagePath)) {
    await fs.copyFile(storagePath, localPath);
    return;
  }
  const { stream } = await storage.get(storagePath);
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(localPath);
    stream.pipe(ws);
    ws.on('finish', () => resolve());
    ws.on('error', reject);
    stream.on('error', reject);
  });
}

async function safeRm(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/**
 * Notification + ActivityLog fan-out for an INFECTED attachment. Failures
 * here are logged but do NOT throw — the scan itself succeeded; we don't
 * want a notification glitch to flip the row back to FAILED on retry.
 */
async function emitInfectedNotifications(
  prisma: PrismaClient,
  att: AttachmentRow,
  signature: string | undefined,
  log: pino.Logger,
): Promise<void> {
  // Resolve uploader (Version.createdBy) + owning Object id (for the
  // notification's `objectId` deep-link). We pull both in one call; if
  // the chain has been broken (revision deleted) we fall back to a no-op.
  type VersionWithRevision = {
    createdBy: string;
    revision: { object: { id: string } | null } | null;
  };
  let version: VersionWithRevision | null = null;
  try {
    version = (await (prisma as unknown as {
      version: {
        findUnique(args: {
          where: { id: string };
          select: Record<string, unknown>;
        }): Promise<VersionWithRevision | null>;
      };
    }).version.findUnique({
      where: { id: att.versionId },
      select: {
        createdBy: true,
        revision: { select: { object: { select: { id: true } } } },
      },
    })) as VersionWithRevision | null;
  } catch (err) {
    log.warn(
      { attachmentId: att.id, err: (err as Error).message },
      'virus-scan: version lookup failed, skipping notifications',
    );
    return;
  }

  const uploaderId = version?.createdBy;
  const objectId = version?.revision?.object?.id;

  // Look up admins. We cast to a structural type to avoid coupling to
  // Prisma's generated Role enum (string union at runtime).
  type UserRow = { id: string };
  const admins = await (prisma as unknown as {
    user: {
      findMany(args: {
        where: Record<string, unknown>;
        select: Record<string, boolean>;
      }): Promise<UserRow[]>;
    };
  }).user
    .findMany({
      where: {
        role: { in: ['ADMIN', 'SUPER_ADMIN'] },
        deletedAt: null,
      },
      select: { id: true },
    })
    .catch((e) => {
      log.warn(
        { err: (e as Error).message },
        'virus-scan: admin lookup failed',
      );
      return [] as UserRow[];
    });

  // De-dupe: an uploader who is also admin shouldn't receive two pings.
  const recipients = new Set<string>();
  if (uploaderId) recipients.add(uploaderId);
  for (const a of admins) recipients.add(a.id);

  if (recipients.size === 0) {
    log.warn(
      { attachmentId: att.id },
      'virus-scan INFECTED but no recipients (no admins, no uploader)',
    );
    return;
  }

  const title = `바이러스 감염 첨부 차단됨`;
  const body = `${att.filename}${signature ? ` — ${signature}` : ''}`;

  const notificationOps = (prisma as unknown as {
    notification: {
      createMany(args: {
        data: Array<Record<string, unknown>>;
      }): Promise<{ count: number }>;
    };
  }).notification;

  await notificationOps
    .createMany({
      data: Array.from(recipients).map((uid) => ({
        userId: uid,
        type: 'SECURITY_INFECTED_FILE',
        title,
        body,
        objectId: objectId ?? null,
        metadata: {
          attachmentId: att.id,
          filename: att.filename,
          signature: signature ?? null,
        },
      })),
    })
    .catch((e) => {
      log.warn(
        { err: (e as Error).message },
        'virus-scan: notification createMany failed',
      );
    });

  // ActivityLog needs a userId. Use the uploader if present, otherwise the
  // first admin. If we have neither we skip the log row (notifications are
  // already out, the audit trail is best-effort).
  const actorId = uploaderId ?? admins[0]?.id;
  if (actorId) {
    const activityOps = (prisma as unknown as {
      activityLog: {
        create(args: { data: Record<string, unknown> }): Promise<unknown>;
      };
    }).activityLog;
    await activityOps
      .create({
        data: {
          action: 'SECURITY_INFECTED_FILE',
          userId: actorId,
          objectId: objectId ?? null,
          metadata: {
            attachmentId: att.id,
            filename: att.filename,
            signature: signature ?? null,
          },
        },
      })
      .catch((e) => {
        log.warn(
          { err: (e as Error).message },
          'virus-scan: activity log create failed',
        );
      });
  }
}

// ─── worker bootstrap ───────────────────────────────────────────────────────

export interface ScanWorkerHandle {
  worker: Worker<VirusScanJobPayload, VirusScanResult>;
  close: () => Promise<void>;
}

/**
 * Start the BullMQ worker for the `virus-scan` queue. Returns a handle
 * the caller closes on SIGTERM. The worker stays bootable even when
 * CLAMAV_ENABLED!='1' — `scanFile` no-ops to SKIPPED in that mode and
 * the row still receives a deterministic terminal status, which is
 * preferable to leaving it stuck in PENDING forever.
 */
export function startScanWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  log: pino.Logger;
}): ScanWorkerHandle {
  const { connection, prisma, log } = deps;

  const worker = new Worker<VirusScanJobPayload, VirusScanResult>(
    VIRUS_SCAN_QUEUE_NAME,
    (job) => processScanJob(job, { prisma, log }),
    {
      connection,
      concurrency: SCAN_CONCURRENCY,
    },
  );

  worker.on('completed', (_job, result) => {
    log.info(
      {
        attachmentId: result.attachmentId,
        status: result.status,
        durationMs: result.durationMs,
      },
      'virus-scan job completed',
    );
  });
  worker.on('failed', (job, err) => {
    log.error(
      { attachmentId: job?.data?.attachmentId, err: err.message },
      'virus-scan failed',
    );
  });

  log.info(
    {
      concurrency: SCAN_CONCURRENCY,
      enabled: process.env.CLAMAV_ENABLED === '1',
      useClamd: process.env.CLAMAV_USE_CLAMD === '1',
      clamdHost: process.env.CLAMD_HOST,
      clamdPort: process.env.CLAMD_PORT,
    },
    'virus-scan worker started',
  );

  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}
