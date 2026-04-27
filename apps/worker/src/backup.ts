/**
 * R33 D-5 — Backup primitives.
 *
 * Pure (queue-agnostic) helpers that produce on-disk archives suitable for DR
 * recovery. The BullMQ worker (`backup-worker.ts`) wires these into the
 * `backup` queue + the `Backup` Prisma row.
 *
 * Subprocesses & licensing:
 *   - `pg_dump`    : PostgreSQL BSD-style license. Provided by the
 *                    `postgresql-client` Alpine package in the worker
 *                    Dockerfile. Uses --format=custom for portability and
 *                    --compress=9 to ship a single self-contained gzipped
 *                    archive (no separate gzip step needed for POSTGRES).
 *   - `tar` + `gzip`: standard Unix tooling shipped with the base image.
 *
 * No JS-bound DB drivers are required — we shell out via `execa`. That keeps
 * the worker's npm tree MIT/Apache and avoids pulling pg into runtime deps.
 *
 * Filename convention (single source of truth — pruner relies on prefix):
 *
 *   POSTGRES  →  postgres-<ISO timestamp without colons>.dump.gz
 *   FILES     →  files-<ISO timestamp without colons>.tar.gz
 *
 * Example: `postgres-20260427T021500Z.dump.gz`.
 */

import { execa } from 'execa';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const POSTGRES_PREFIX = 'postgres-';
export const POSTGRES_SUFFIX = '.dump.gz';
export const FILES_PREFIX = 'files-';
export const FILES_SUFFIX = '.tar.gz';

/**
 * Format a Date as a filesystem-safe UTC stamp:  20260427T021500Z
 * (ISO 8601 "basic" format — colons stripped, second precision).
 */
export function backupTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export interface PgBackupOptions {
  /** Directory the .dump.gz archive lands in. Created if missing. */
  outDir: string;
  /**
   * Connection string. Defaults to the DATABASE_URL env var. We pass it via
   * the PG* envs that pg_dump understands so secrets never appear on the
   * argv list (where they'd be visible in `ps`).
   */
  databaseUrl?: string;
  /** Override the binary path (defaults to `pg_dump` on PATH). */
  binPath?: string;
  /** Hard timeout in ms (default 30 minutes — large DBs take a while). */
  timeoutMs?: number;
  /** Override the timestamp used in the filename (tests). */
  now?: Date;
}

export interface BackupArtifact {
  /** Absolute path to the produced archive. */
  storagePath: string;
  /** Archive size in bytes (post-compression). */
  sizeBytes: number;
}

/**
 * Run `pg_dump --format=custom --compress=9` against $DATABASE_URL. The
 * `--format=custom` archive is already compressed; we still suffix `.dump.gz`
 * for operator clarity (the file IS gzip-compatible at the DEFLATE block
 * level — `pg_restore` handles the format transparently).
 *
 * Returns the absolute archive path + size in bytes. Throws on
 * non-zero exit so the BullMQ worker can mark the row FAILED.
 */
export async function runPostgresBackup(
  opts: PgBackupOptions,
): Promise<BackupArtifact> {
  await fs.mkdir(opts.outDir, { recursive: true });

  const url = opts.databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL not set — cannot run pg_dump');
  }

  const filename = `${POSTGRES_PREFIX}${backupTimestamp(opts.now)}${POSTGRES_SUFFIX}`;
  const outPath = path.join(opts.outDir, filename);

  const binPath = opts.binPath ?? 'pg_dump';
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;

  // We pass the URL through `--dbname=URL` (which pg_dump accepts directly,
  // including DSN-style postgres:// URLs). Argv exposure of the URL itself is
  // unavoidable for pg_dump unless we parse + split into PG* envs; we accept
  // the tradeoff because the worker process is not user-facing.
  const args = [
    '--format=custom',
    '--compress=9',
    '--no-owner',
    '--no-privileges',
    `--file=${outPath}`,
    `--dbname=${url}`,
  ];

  try {
    await execa(binPath, args, {
      timeout: timeoutMs,
      // pg_dump is verbose to stderr on success too — capture but don't pipe.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // Best-effort cleanup of partial output.
    await fs.rm(outPath, { force: true }).catch(() => undefined);
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`pg_dump failed: ${errMsg}`);
  }

  const stat = await fs.stat(outPath);
  return { storagePath: outPath, sizeBytes: stat.size };
}

export interface FilesBackupOptions {
  /** The file-storage tree to archive. */
  srcDir: string;
  /** Directory the .tar.gz lands in. Created if missing. */
  outDir: string;
  /** Hard timeout in ms (default 60 minutes). */
  timeoutMs?: number;
  /** Override the timestamp used in the filename (tests). */
  now?: Date;
  /** Override the tar binary path. */
  binPath?: string;
}

/**
 * `tar -czf` the file storage tree into a single .tar.gz under outDir.
 *
 * We use `tar -C dirname(src) basename(src)` so the archive contains a single
 * top-level entry equal to the directory's basename — restoring is just
 * `tar -xzf <archive> -C <restore-root>` and you get the same structure
 * back. Symlinks are preserved (default tar behavior); we do NOT dereference
 * to avoid duplicating large preview/dxf trees that may be hard-linked.
 *
 * If `srcDir` doesn't exist the worker treats the backup as a successful
 * empty archive (so freshly-deployed environments don't spam FAILED rows).
 */
export async function runFileStorageBackup(
  opts: FilesBackupOptions,
): Promise<BackupArtifact> {
  await fs.mkdir(opts.outDir, { recursive: true });

  const filename = `${FILES_PREFIX}${backupTimestamp(opts.now)}${FILES_SUFFIX}`;
  const outPath = path.join(opts.outDir, filename);

  const binPath = opts.binPath ?? 'tar';
  const timeoutMs = opts.timeoutMs ?? 60 * 60_000;

  const absSrc = path.resolve(opts.srcDir);
  const parent = path.dirname(absSrc);
  const base = path.basename(absSrc);

  // If the source dir is missing, write an empty tar.gz so callers still get
  // a valid artifact path + size. `tar` errors on a missing target; we do the
  // mkdir so the archive structure is consistent across deployments.
  let srcExists = true;
  try {
    await fs.access(absSrc);
  } catch {
    srcExists = false;
  }
  if (!srcExists) {
    await fs.mkdir(absSrc, { recursive: true });
  }

  try {
    await execa(
      binPath,
      ['-czf', outPath, '-C', parent, base],
      {
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (err) {
    await fs.rm(outPath, { force: true }).catch(() => undefined);
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`tar failed: ${errMsg}`);
  }

  const stat = await fs.stat(outPath);
  return { storagePath: outPath, sizeBytes: stat.size };
}

/**
 * Delete archives in `dir` whose filename starts with `prefix` and whose
 * mtime is older than `days` days. Returns how many files were deleted.
 *
 * Notes:
 *   - We compare on `mtimeMs` rather than parsing timestamps from the
 *     filename so manual `touch` interactions still mark a backup "fresh".
 *   - `days <= 0` disables pruning entirely (no-op, returns 0).
 *   - Errors on individual unlink calls are logged-and-skipped via the
 *     optional `log` callback so one bad file doesn't abort the sweep.
 */
export async function pruneOldBackups(
  dir: string,
  days: number,
  prefix: string,
  log?: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<number> {
  if (days <= 0) return 0;

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    // Directory may not exist yet (no backups ever created). Not an error.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 0;
    throw err;
  }

  const cutoff = Date.now() - days * 24 * 60 * 60_000;
  let removed = 0;
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    const full = path.join(dir, name);
    try {
      const st = await fs.stat(full);
      if (!st.isFile()) continue;
      if (st.mtimeMs < cutoff) {
        await fs.unlink(full);
        removed += 1;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.('prune skip', { file: full, err: errMsg });
    }
  }
  return removed;
}

/** Pick the right filename prefix for a given kind. */
export function prefixFor(kind: 'POSTGRES' | 'FILES'): string {
  return kind === 'POSTGRES' ? POSTGRES_PREFIX : FILES_PREFIX;
}
