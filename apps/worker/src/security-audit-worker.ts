/**
 * R-AUDIT-TREND — `pnpm audit` snapshot worker (FIND-016 mitigation).
 *
 * Consumes `SecurityAuditJobPayload` jobs from the `security-audit` queue.
 * Each job:
 *   1) Spawns `pnpm audit --json` as a subprocess (90s timeout).
 *   2) Parses the stdout via `@drawing-mgmt/shared/pnpm-audit-parser` —
 *      same code path as the legacy admin GET/POST route, so counts stay
 *      in sync.
 *   3) Inserts a `SecurityAuditSnapshot` row with the four severity
 *      counts + total + source ('cron' or 'manual') + durationMs +
 *      optional `advisoriesJson` (32 KB cap).
 *   4) Best-effort retention purge — deletes snapshot rows older than
 *      `SECURITY_AUDIT_RETENTION_DAYS` (default 365). Failure to purge is
 *      logged but never fails the job.
 *
 * Daily cron:
 *   `SECURITY_AUDIT_CRON_ENABLED=1` enrolls a repeatable on
 *   `SECURITY_AUDIT_CRON_PATTERN` (default '30 2 * * *' — 02:30 UTC,
 *   separated from BACKUP_CRON's 02:00 to avoid IO competition on a
 *   single-host box).
 *
 * License posture: subprocess-only. We never import `pnpm` or any audit
 * library as JS — child_process spawn matches the LibreDWG / ClamAV
 * isolation pattern used elsewhere in the worker tree. The advisory data
 * is not derived from npm/pnpm code; it's parsed text-only from stdout.
 */

import { Queue, Worker, type Job } from 'bullmq';
import type { Redis as IORedis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import { spawn } from 'node:child_process';
import {
  SECURITY_AUDIT_QUEUE_NAME,
  SecurityAuditJobPayloadSchema,
  type SecurityAuditJobPayload,
  type SecurityAuditResult,
} from '@drawing-mgmt/shared/conversion';
import {
  parseAuditDetail,
  sumCounts,
  type AdvisoryEntry,
  type VulnerabilityCounts,
} from '@drawing-mgmt/shared/pnpm-audit-parser';

// ─── env ────────────────────────────────────────────────────────────────────

const CRON_ENABLED = process.env.SECURITY_AUDIT_CRON_ENABLED === '1';
const CRON_PATTERN = process.env.SECURITY_AUDIT_CRON_PATTERN ?? '30 2 * * *';
const RETENTION_DAYS = Number(
  process.env.SECURITY_AUDIT_RETENTION_DAYS ?? 365,
);
const AUDIT_TIMEOUT_MS = 90_000;
// Cap the JSONB blob so a 100-advisory pnpm output doesn't blow up the row.
// Past the cap we store an empty array (`[]`) — the counts row is still
// useful and the operator can re-run pnpm audit interactively for detail.
const ADVISORIES_JSON_CAP_BYTES = 32 * 1024;

// ─── Snapshot row Prisma surface ────────────────────────────────────────────
//
// `SecurityAuditSnapshot` is added in this round; the worker uses the
// generated delegate. We narrow the surface to just the calls we make so
// regenerating Prisma with extra columns later doesn't ripple through.

interface SnapshotCreateData {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  total: number;
  source: string;
  durationMs: number | null;
  advisoriesJson: unknown;
}

interface SnapshotModelOps {
  create(args: {
    data: SnapshotCreateData;
    select: { id: true };
  }): Promise<{ id: string }>;
  deleteMany(args: {
    where: { takenAt: { lt: Date } };
  }): Promise<{ count: number }>;
}

function snapshotModel(prisma: PrismaClient): SnapshotModelOps {
  // Prisma exposes models via lowercase delegate name. After R-AUDIT-TREND's
  // migration `prisma.securityAuditSnapshot` is the typed delegate. If the
  // migration isn't applied yet the runtime call surfaces as a job failure
  // — which is the correct behavior (the worker shouldn't silently succeed
  // when there's nowhere to write).
  const dyn = prisma as unknown as {
    securityAuditSnapshot?: SnapshotModelOps;
  };
  if (!dyn.securityAuditSnapshot) {
    throw new Error(
      'prisma.securityAuditSnapshot is not available — R-AUDIT-TREND migration not yet applied',
    );
  }
  return dyn.securityAuditSnapshot;
}

// ─── job handler ────────────────────────────────────────────────────────────

interface ProcessDeps {
  prisma: PrismaClient;
  log: pino.Logger;
}

export async function processAuditJob(
  job: Job<SecurityAuditJobPayload>,
  deps: ProcessDeps,
): Promise<SecurityAuditResult> {
  const payload = SecurityAuditJobPayloadSchema.parse(job.data);
  const { prisma, log } = deps;

  log.info(
    { source: payload.source, attempt: job.attemptsMade + 1 },
    'security-audit job start',
  );

  const audit = await runPnpmAudit();
  const total = sumCounts(audit.counts);

  const ops = snapshotModel(prisma);
  const advisoriesJson = capAdvisories(audit.advisories);

  const created = await ops.create({
    data: {
      critical: audit.counts.critical,
      high: audit.counts.high,
      moderate: audit.counts.moderate,
      low: audit.counts.low,
      total,
      source: payload.source,
      durationMs: audit.durationMs,
      advisoriesJson,
    },
    select: { id: true },
  });

  log.info(
    {
      snapshotId: created.id,
      source: payload.source,
      total,
      durationMs: audit.durationMs,
    },
    'security-audit snapshot saved',
  );

  // Best-effort retention purge. Failure here is logged but does NOT fail
  // the job — the snapshot itself is already persisted.
  if (RETENTION_DAYS > 0) {
    try {
      const cutoff = new Date(
        Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const purged = await ops.deleteMany({
        where: { takenAt: { lt: cutoff } },
      });
      if (purged.count > 0) {
        log.info(
          { purged: purged.count, cutoff: cutoff.toISOString() },
          'security-audit retention purge',
        );
      }
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'security-audit retention purge failed (non-fatal)',
      );
    }
  }

  return {
    snapshotId: created.id,
    total,
    durationMs: audit.durationMs,
  };
}

/**
 * Apply the 32 KB cap on the advisory JSON. Past the cap we return `[]`
 * so the row stays small; the counts already capture severity totals so
 * losing the per-advisory detail is acceptable for trend analysis. The
 * operator can re-run `pnpm audit` interactively for the full breakdown.
 */
function capAdvisories(advisories: AdvisoryEntry[]): AdvisoryEntry[] {
  if (advisories.length === 0) return [];
  // Estimate via JSON.stringify byte length. Buffer.byteLength is more
  // accurate for multi-byte (Korean package descriptions etc.) so we use
  // it to be conservative.
  const serialized = JSON.stringify(advisories);
  if (Buffer.byteLength(serialized, 'utf8') <= ADVISORIES_JSON_CAP_BYTES) {
    return advisories;
  }
  return [];
}

// ─── pnpm audit subprocess ─────────────────────────────────────────────────

interface PnpmAuditResult {
  counts: VulnerabilityCounts;
  advisories: AdvisoryEntry[];
  durationMs: number;
}

/**
 * Spawn `pnpm audit --json` from the monorepo root (`process.cwd()` —
 * apps/worker boots there in dev/prod). Resolves with the parsed audit
 * tuple + wallclock duration. Rejects on subprocess error or unexpected
 * exit code (pnpm audit exits 1 when vulnerabilities exist — that is the
 * expected happy-path-with-issues case, NOT a failure).
 */
function runPnpmAudit(): Promise<PnpmAuditResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn('pnpm', ['audit', '--json'], {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | null = null;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => reject(new Error('pnpm audit timed out')));
    }, AUDIT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => {
      // Exit 0 = no vulns, 1 = vulns found (still successful audit). Anything
      // else surfaces stderr in the rejection so retries see the real cause.
      if (code !== 0 && code !== 1) {
        finish(() =>
          reject(
            new Error(
              `pnpm audit exited with code=${code}: ${stderr.slice(0, 500)}`,
            ),
          ),
        );
        return;
      }
      try {
        const detail = parseAuditDetail(stdout);
        finish(() =>
          resolve({
            counts: detail.counts,
            advisories: detail.advisories,
            durationMs: Date.now() - startedAt,
          }),
        );
      } catch (err) {
        finish(() => reject(err));
      }
    });
  });
}

// ─── worker bootstrap ───────────────────────────────────────────────────────

export interface SecurityAuditWorkerHandle {
  worker: Worker<SecurityAuditJobPayload, SecurityAuditResult>;
  queue: Queue<SecurityAuditJobPayload, SecurityAuditResult>;
  close: () => Promise<void>;
}

/**
 * Start the `security-audit` BullMQ worker, register the daily repeatable
 * if `SECURITY_AUDIT_CRON_ENABLED=1`, and return a handle the caller can
 * close on SIGTERM. Mirrors `apps/worker/src/backup-worker.ts` exactly.
 */
export function startSecurityAuditWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  log: pino.Logger;
}): SecurityAuditWorkerHandle {
  const { connection, prisma, log } = deps;

  const worker = new Worker<SecurityAuditJobPayload, SecurityAuditResult>(
    SECURITY_AUDIT_QUEUE_NAME,
    (job) => processAuditJob(job, { prisma, log }),
    {
      connection,
      // pnpm audit is registry-bound IO. Keep concurrency at 1 — we
      // never need parallel audits and it avoids spawning duplicate
      // pnpm subprocesses.
      concurrency: 1,
    },
  );

  worker.on('completed', (_job, result) => {
    log.info(
      {
        snapshotId: result.snapshotId,
        total: result.total,
        durationMs: result.durationMs,
      },
      'security-audit job completed',
    );
  });
  worker.on('failed', (job, err) => {
    log.error(
      {
        source: job?.data?.source,
        err: err.message,
      },
      'security-audit failed',
    );
  });

  // Queue handle — only used to schedule the cron repeatable. Construct on
  // the same connection so the shutdown sequence stays symmetric.
  const queue = new Queue<SecurityAuditJobPayload, SecurityAuditResult>(
    SECURITY_AUDIT_QUEUE_NAME,
    { connection },
  );

  if (CRON_ENABLED) {
    queue
      .add(
        'cron-snapshot',
        { source: 'cron' },
        {
          repeat: { pattern: CRON_PATTERN },
          jobId: 'cron-snapshot',
          attempts: 2,
          backoff: { type: 'exponential', delay: 5 * 60_000 },
          removeOnComplete: { age: 7 * 24 * 3600, count: 50 },
          removeOnFail: { age: 30 * 24 * 3600, count: 100 },
        },
      )
      .catch((e) =>
        log.warn(
          { err: (e as Error).message },
          'register security-audit cron-snapshot failed',
        ),
      );
    log.info(
      { pattern: CRON_PATTERN, retentionDays: RETENTION_DAYS },
      'security-audit cron enabled',
    );
  } else {
    log.info(
      { retentionDays: RETENTION_DAYS },
      'security-audit worker started (cron disabled)',
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
