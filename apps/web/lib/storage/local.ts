// LocalStorage driver — fs-backed implementation of the Storage interface.
//
// Mirrors the on-disk layout the existing routes already use:
//   FILE_STORAGE_ROOT/<attachmentId>/source.<ext>
//                    /<attachmentId>/preview.dxf
//                    /<attachmentId>/preview.pdf
//                    /<attachmentId>/thumbnail.png
//                    /<attachmentId>/print-<ctb>-<pageSize>.pdf
//
// Why this driver still exists when S3 is the long-term target:
//   - Default for local dev / single-host on-prem deployments — keeps
//     `pnpm dev` working without docker MinIO.
//   - Backwards compatible with R21 attachments persisted before R34;
//     the key format is identical to the historical `storagePath`.
//
// Path-traversal hardening:
//   - `assertSafeKey` rejects empty keys, leading slash, '..' segments,
//     backslashes, and characters outside [A-Za-z0-9_./-]. Anything that
//     could escape the storage root must fail before we touch the FS.
//   - `resolveKey` re-checks via `path.resolve` + `startsWith(root)` so a
//     race between the syntactic check and the real resolution can't slip
//     through (defense in depth — the syntactic gate already blocks `..`,
//     but environments that do symlink games still need this).

import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  Storage,
  StorageGetResult,
  StorageKeyError,
  StorageListOptions,
  StorageListResult,
  StorageNotFoundError,
  StorageObject,
  StoragePutOptions,
  StoragePutResult,
} from '@drawing-mgmt/shared/storage';

export interface LocalStorageConfig {
  /** Filesystem root where keys are anchored. Created on first write. */
  rootPath: string;
}

export class LocalStorage implements Storage {
  private readonly root: string;

  constructor(config: LocalStorageConfig) {
    this.root = path.resolve(config.rootPath);
  }

  // ───────────────────────── put ─────────────────────────
  async put(
    key: string,
    body: Buffer | NodeJS.ReadableStream,
    _opts?: StoragePutOptions,
  ): Promise<StoragePutResult> {
    const filePath = this.resolveKey(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (Buffer.isBuffer(body)) {
      await fs.writeFile(filePath, body);
      return { key, size: body.byteLength };
    }

    // Stream case — pipe into a write stream to keep memory flat.
    const writeStream = (await fs.open(filePath, 'w')).createWriteStream();
    let written = 0;
    await new Promise<void>((resolve, reject) => {
      body.on('data', (chunk: Buffer | string) => {
        if (typeof chunk === 'string') {
          written += Buffer.byteLength(chunk);
        } else {
          written += chunk.byteLength;
        }
      });
      body.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', () => resolve());
      body.pipe(writeStream);
    });
    return { key, size: written };
  }

  // ───────────────────────── get ─────────────────────────
  async get(key: string): Promise<StorageGetResult> {
    const filePath = this.resolveKey(key);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (err) {
      if (isENOENT(err)) throw new StorageNotFoundError(key);
      throw err;
    }
    const stream = createReadStream(filePath);
    return {
      stream,
      size: stat.size,
      lastModified: stat.mtime,
    };
  }

  // ───────────────────────── exists / delete / stat ─────────────────────────
  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolveKey(key);
    await fs.rm(filePath, { force: true });
  }

  async stat(key: string): Promise<StorageObject | null> {
    const filePath = this.resolveKey(key);
    try {
      const s = await fs.stat(filePath);
      if (!s.isFile()) return null;
      return {
        key,
        size: s.size,
        lastModified: s.mtime,
      };
    } catch (err) {
      if (isENOENT(err)) return null;
      throw err;
    }
  }

  // ───────────────────────── list ─────────────────────────
  /**
   * Recursively walk the directory rooted at `prefix`. Returns up to
   * `opts.limit` entries (default 1000). Cursor is the path of the last
   * returned key — callers pass it back to resume from the next entry.
   *
   * Note: this is a server-side aggregate — for very large stores the S3
   * driver is preferable since it paginates natively. The local driver
   * scans recursively under `prefix` so admin "info" probes work.
   */
  async list(
    prefix: string,
    opts: StorageListOptions = {},
  ): Promise<StorageListResult> {
    const limit = Math.max(1, Math.min(opts.limit ?? 1000, 10_000));
    const cursor = opts.cursor;

    // Allow empty prefix to mean "root listing".
    const trimmed = prefix.replace(/^\/+|\/+$/g, '');
    if (trimmed) {
      // Only validate non-empty prefixes — the empty string is always safe
      // (it's the storage root). Allow trailing-less prefix paths.
      assertSafeKey(trimmed, /* allowDir */ true);
    }
    const listRoot = trimmed
      ? path.resolve(this.root, trimmed)
      : this.root;

    const items: StorageObject[] = [];
    let skipped = !cursor;
    let nextCursor: string | undefined;

    const stack: string[] = [];
    if (await dirExists(listRoot)) {
      stack.push(listRoot);
    }

    // Depth-first traversal; sort each directory's entries to keep order
    // stable across calls (matters for cursor-based pagination).
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const ent of entries) {
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!ent.isFile()) continue;
        const rel = path.relative(this.root, abs).split(path.sep).join('/');
        if (!skipped) {
          if (rel === cursor) skipped = true;
          continue;
        }
        if (items.length >= limit) {
          const last = items[items.length - 1];
          if (last) nextCursor = last.key;
          return { items, nextCursor };
        }
        try {
          const s = await fs.stat(abs);
          items.push({ key: rel, size: s.size, lastModified: s.mtime });
        } catch {
          /* file vanished during walk — skip */
        }
      }
    }

    return { items };
  }

  // ───────────────────────── helpers ─────────────────────────
  /**
   * Resolve a key to an absolute path under `this.root`. Throws
   * StorageKeyError if the resolution escapes the root.
   */
  private resolveKey(key: string): string {
    assertSafeKey(key);
    const abs = path.resolve(this.root, key);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new StorageKeyError(`storage: key resolves outside root: ${key}`);
    }
    return abs;
  }

  /** Expose the resolved root for diagnostics (admin info endpoint). */
  get rootPath(): string {
    return this.root;
  }
}

// ─────────────────────────────────────────────────────────────
// Module helpers
// ─────────────────────────────────────────────────────────────
const SAFE_KEY = /^[A-Za-z0-9_./-]+$/;

/**
 * Reject empty keys, absolute paths, '..' segments, backslashes, and
 * non-printable / non-ASCII characters.
 *
 * `allowDir=true` permits keys that look like directory prefixes (used by
 * `list()` for the prefix arg).
 */
function assertSafeKey(key: string, allowDir = false): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new StorageKeyError('storage: empty key');
  }
  if (key.length > 1024) {
    throw new StorageKeyError('storage: key too long (max 1024)');
  }
  if (key.startsWith('/') || key.startsWith('\\')) {
    throw new StorageKeyError(`storage: absolute key not allowed: ${key}`);
  }
  if (key.includes('\\')) {
    throw new StorageKeyError(`storage: backslash not allowed: ${key}`);
  }
  if (!SAFE_KEY.test(key)) {
    throw new StorageKeyError(`storage: key contains illegal characters: ${key}`);
  }
  // '..' segment check — split on '/' to avoid false positives ('a..b').
  for (const part of key.split('/')) {
    if (part === '..') {
      throw new StorageKeyError(`storage: '..' segment not allowed: ${key}`);
    }
    if (!allowDir && part === '') {
      throw new StorageKeyError(`storage: empty segment not allowed: ${key}`);
    }
  }
}

function isENOENT(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ENOENT',
  );
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

// Re-export Readable for convenience — callers that build streams to feed
// into LocalStorage.put() can import it from one place.
export { Readable };
