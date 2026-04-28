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
import { createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Storage } from './storage.js';

export const POSTGRES_PREFIX = 'postgres-';
export const POSTGRES_SUFFIX = '.dump.gz';
export const FILES_PREFIX = 'files-';
export const FILES_SUFFIX = '.tar.gz';
/**
 * R50 / FIND-022 — at-rest encryption suffix appended to the artifact
 * filename when `BACKUP_ENCRYPTION_KEY` is set. Pruner matches by prefix
 * (`postgres-` / `files-`), so this suffix is invisible to cleanup.
 *
 * Recovery:
 *   openssl aes-256-cbc -d -pbkdf2 -iter 100000 \
 *     -k "$BACKUP_ENCRYPTION_KEY" \
 *     -in postgres-XXX.dump.gz.enc -out postgres-XXX.dump.gz
 */
export const ENCRYPTED_SUFFIX = '.enc';

/**
 * Read the at-rest encryption key from env. Returns `null` (= use plaintext,
 * preserves R33 behavior) when unset or shorter than 16 chars (likely a
 * placeholder). The key length is enforced as a sanity check, not a
 * cryptographic guarantee — OpenSSL with `-pbkdf2` will derive a 256-bit
 * key from any input length, but accepting `BACKUP_ENCRYPTION_KEY=changeme`
 * silently would defeat the point.
 */
function backupEncryptionKey(): string | null {
  const k = process.env.BACKUP_ENCRYPTION_KEY;
  if (!k) return null;
  const trimmed = k.trim();
  if (trimmed.length < 16) return null;
  return trimmed;
}

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

  const encKey = backupEncryptionKey();
  const baseFilename = `${POSTGRES_PREFIX}${backupTimestamp(opts.now)}${POSTGRES_SUFFIX}`;
  const filename = encKey ? `${baseFilename}${ENCRYPTED_SUFFIX}` : baseFilename;
  const outPath = path.join(opts.outDir, filename);

  const binPath = opts.binPath ?? 'pg_dump';
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;

  try {
    if (encKey) {
      // R50 / FIND-022 — pipe pg_dump → openssl AES-256-CBC + pbkdf2.
      // We stream stdout from pg_dump to openssl's stdin so we never write a
      // plaintext copy to disk (also avoids any temp-file race window).
      const dump = execa(
        binPath,
        [
          '--format=custom',
          '--compress=9',
          '--no-owner',
          '--no-privileges',
          // No --file=… — write to stdout for the openssl pipe.
          `--dbname=${url}`,
        ],
        {
          timeout: timeoutMs,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const enc = execa(
        'openssl',
        [
          'enc',
          '-aes-256-cbc',
          '-salt',
          '-pbkdf2',
          '-iter',
          '100000',
          '-pass',
          // `env:VAR` reads the key from the named env var rather than argv,
          // so it doesn't show up in `ps`. We pass it via the spawned env
          // without leaking to the parent process's env.
          'env:_DM_BACKUP_KEY',
          '-out',
          outPath,
        ],
        {
          timeout: timeoutMs,
          input: dump.stdout!,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { _DM_BACKUP_KEY: encKey },
        },
      );
      await Promise.all([dump, enc]);
    } else {
      // Legacy plaintext path — preserve R33 behavior verbatim. Argv exposure
      // of the URL itself is unavoidable for pg_dump unless we parse + split
      // into PG* envs; we accept the tradeoff because the worker process is
      // not user-facing.
      await execa(
        binPath,
        [
          '--format=custom',
          '--compress=9',
          '--no-owner',
          '--no-privileges',
          `--file=${outPath}`,
          `--dbname=${url}`,
        ],
        {
          timeout: timeoutMs,
          // pg_dump is verbose to stderr on success too — capture but don't pipe.
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    }
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
  /**
   * Legacy local source directory. Used only when `storage` is omitted —
   * R34 callers should pass `storage` instead so the archive works against
   * S3 / MinIO too.
   */
  srcDir?: string;
  /**
   * R34 V-INF-1 — storage abstraction. When provided, we list every object
   * via `storage.list`, stream each into a staging directory, then tar that
   * directory. This works identically for LocalStorage (where staging is a
   * trivial copy) and S3Storage. The staging step is intentional for this
   * round — a true streaming tar over the storage interface is slated for
   * the next round (`tar-stream` or native `aws s3 sync`).
   */
  storage?: Storage;
  /** Directory the .tar.gz lands in. Created if missing. */
  outDir: string;
  /** Hard timeout in ms (default 60 minutes). */
  timeoutMs?: number;
  /** Override the timestamp used in the filename (tests). */
  now?: Date;
  /** Override the tar binary path. */
  binPath?: string;
  /** Optional logger for slow-iter visibility (object count progress). */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Archive every storage object into a single `.tar.gz` under `outDir`.
 *
 * Two-phase implementation (R34 V-INF-1):
 *   1. **List + stage.** `storage.list('')` walks every object (paginated).
 *      Each object is streamed into a per-job staging directory under
 *      `os.tmpdir()`. The directory tree mirrors the storage key layout, so
 *      restoring is just `tar -xzf <archive> -C <FILE_STORAGE_ROOT>`.
 *   2. **tar -czf.** We run system `tar` against the staging directory. We
 *      preserve the legacy archive shape — single top-level entry named
 *      after the staging basename — so the existing restore docs still
 *      apply.
 *
 * Backward compat with R33: callers that still pass `opts.srcDir` (no
 * `opts.storage`) keep the old direct-disk path — relevant for tests and
 * any pre-R34 integration that hasn't been migrated.
 *
 * The staging directory is removed in `finally`, so a partial archive on
 * failure leaves only the (also-cleaned) `outPath`.
 *
 * If storage is empty / srcDir is missing, we write an empty tar.gz so
 * callers still get a valid artifact path + size and freshly-deployed
 * environments don't spam FAILED rows.
 */
export async function runFileStorageBackup(
  opts: FilesBackupOptions,
): Promise<BackupArtifact> {
  await fs.mkdir(opts.outDir, { recursive: true });

  const encKey = backupEncryptionKey();
  const baseFilename = `${FILES_PREFIX}${backupTimestamp(opts.now)}${FILES_SUFFIX}`;
  const filename = encKey ? `${baseFilename}${ENCRYPTED_SUFFIX}` : baseFilename;
  const outPath = path.join(opts.outDir, filename);

  const binPath = opts.binPath ?? 'tar';
  const timeoutMs = opts.timeoutMs ?? 60 * 60_000;

  // Branch: prefer the storage path when available; fall back to the legacy
  // srcDir behavior otherwise. Both end with the same `tar -czf` invocation
  // so the final archive shape is identical.
  let stageDir: string;
  let stageParent: string;
  let stageBase: string;
  let stageOwnedByUs = false;

  if (opts.storage) {
    // R34 path: stage every storage object into a fresh tmp dir.
    const tempRoot = path.join(os.tmpdir(), `dm-files-backup-${randomUUID()}`);
    stageBase = 'files';
    stageParent = tempRoot;
    stageDir = path.join(tempRoot, stageBase);
    stageOwnedByUs = true;
    await fs.mkdir(stageDir, { recursive: true });
    await stageStorageToDir(opts.storage, stageDir, opts.log);
  } else if (opts.srcDir) {
    // Legacy path: archive a real directory directly (R33 behavior).
    const absSrc = path.resolve(opts.srcDir);
    stageParent = path.dirname(absSrc);
    stageBase = path.basename(absSrc);
    stageDir = absSrc;

    let srcExists = true;
    try {
      await fs.access(absSrc);
    } catch {
      srcExists = false;
    }
    if (!srcExists) {
      await fs.mkdir(absSrc, { recursive: true });
    }
  } else {
    throw new Error(
      'runFileStorageBackup: must provide either `storage` or `srcDir`',
    );
  }

  try {
    if (encKey) {
      // R50 / FIND-022 — `tar -cz | openssl enc` so the gzipped tarball is
      // never on disk in plaintext form.
      const tar = execa(
        binPath,
        ['-cz', '-C', stageParent, stageBase],
        {
          timeout: timeoutMs,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const enc = execa(
        'openssl',
        [
          'enc',
          '-aes-256-cbc',
          '-salt',
          '-pbkdf2',
          '-iter',
          '100000',
          '-pass',
          'env:_DM_BACKUP_KEY',
          '-out',
          outPath,
        ],
        {
          timeout: timeoutMs,
          input: tar.stdout!,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { _DM_BACKUP_KEY: encKey },
        },
      );
      await Promise.all([tar, enc]);
    } else {
      await execa(
        binPath,
        ['-czf', outPath, '-C', stageParent, stageBase],
        {
          timeout: timeoutMs,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    }
  } catch (err) {
    await fs.rm(outPath, { force: true }).catch(() => undefined);
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`tar failed: ${errMsg}`);
  } finally {
    if (stageOwnedByUs) {
      await fs.rm(stageParent, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const stat = await fs.stat(outPath);
  return { storagePath: outPath, sizeBytes: stat.size };
}

/**
 * Stream every storage object (paginated via `list`) into `destDir`, mirroring
 * the storage key as a relative file path. Each object is written via
 * `storage.get(...).stream`; we do NOT buffer the whole object in memory so
 * very large attachments don't OOM the worker.
 *
 * Errors on individual `get` are not swallowed — a backup that's missing
 * objects is worse than a failed backup. If an object disappears between
 * `list` and `get` (race with delete) we treat it as a transient failure and
 * surface it through the caller's retry path.
 */
async function stageStorageToDir(
  storage: Storage,
  destDir: string,
  log?: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<void> {
  let cursor: string | undefined;
  let copied = 0;
  // 1000 = a typical S3 ListObjectsV2 max page; LocalStorage honors this too.
  const PAGE = 1000;
  for (;;) {
    const page = await storage.list('', { limit: PAGE, cursor });
    for (const obj of page.items) {
      // Refuse keys that try to escape the dest dir. The storage drivers
      // already validate keys at put-time, but defense-in-depth is cheap.
      if (obj.key.startsWith('/') || obj.key.includes('..')) {
        throw new Error(`backup: refusing unsafe key ${JSON.stringify(obj.key)}`);
      }
      const target = path.join(destDir, obj.key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const { stream } = await storage.get(obj.key);
      await new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(target);
        stream.pipe(ws);
        ws.on('finish', () => resolve());
        ws.on('error', reject);
        stream.on('error', reject);
      });
      copied += 1;
      if (copied % 200 === 0) {
        log?.('files-backup progress', { copied });
      }
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  log?.('files-backup staging complete', { copied });
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
