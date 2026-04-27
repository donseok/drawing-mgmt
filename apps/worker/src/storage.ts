/**
 * R34 V-INF-1 — Worker-side storage abstraction.
 *
 * Mirrors the interface defined in `packages/shared/src/storage.ts` (owned by
 * backend, see `_workspace/api_contract.md` §3.1). The worker keeps its own
 * driver implementations rather than importing `apps/web/lib/storage` because
 * crossing the workspace boundary (worker → web) would force the worker
 * Dockerfile to ship the entire web package. Re-implementing the two drivers
 * here is ~150 lines and avoids that coupling.
 *
 * Drivers:
 *   - LocalStorage : filesystem-backed (preserves the existing
 *                    `<FILE_STORAGE_ROOT>/<key>` layout for backward compat).
 *   - S3Storage    : `@aws-sdk/client-s3` + path-style for MinIO compatibility
 *                    (`forcePathStyle: true`). Apache 2.0, no GPL deps.
 *
 * Selection: factory `getStorage()` reads `STORAGE_DRIVER` env (default
 * `'local'`). Singleton — driver config is immutable for the worker's
 * lifetime, matching the web side.
 *
 * Key safety:
 *   - LocalStorage rejects keys containing `..` segments or starting with `/`
 *     to prevent directory escape (mirrors the rule on the web side).
 *   - All keys are stored / retrieved verbatim relative to `rootPath` (local)
 *     or `bucket` (s3). Callers are responsible for namespacing
 *     (e.g. `<attachmentId>/preview.dxf`).
 *
 * Streaming:
 *   - `put` accepts `Buffer | Readable`. The S3 driver requires a known
 *     content-length for streams; if `opts.size` is omitted on a stream we
 *     fall back to buffering into memory (acceptable for thumbnails / small
 *     PDFs; future S3 multipart upload tracked as a follow-up).
 *   - `get` always returns a Readable. Local opens an `fs.createReadStream`;
 *     S3 returns the SDK body (already a Readable in Node).
 */

import {
  createReadStream,
  createWriteStream,
  promises as fs,
} from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// ───────────────────────────────────────────────────────────────────────────
// Public types — mirror packages/shared/src/storage.ts (backend-owned).
// ───────────────────────────────────────────────────────────────────────────

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  contentType?: string;
}

export interface PutOptions {
  contentType?: string;
  /** Required when `body` is a Readable for the S3 driver. */
  size?: number;
}

export interface ListOptions {
  limit?: number;
  cursor?: string;
}

export interface SignedUrlOptions {
  expiresIn?: number;
  method?: 'GET' | 'PUT';
}

export interface Storage {
  put(
    key: string,
    body: Buffer | NodeJS.ReadableStream,
    opts?: PutOptions,
  ): Promise<{ key: string; size: number }>;
  get(
    key: string,
  ): Promise<{
    stream: NodeJS.ReadableStream;
    size: number;
    contentType?: string;
  }>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  stat(key: string): Promise<StorageObject | null>;
  list(
    prefix: string,
    opts?: ListOptions,
  ): Promise<{ items: StorageObject[]; nextCursor?: string }>;
  getSignedUrl?(key: string, opts?: SignedUrlOptions): Promise<string>;
}

export interface StorageDriverConfig {
  driver: 'local' | 's3';
  rootPath?: string;
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Key validation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reject keys that would let a caller escape the storage root via `..` or
 * absolute paths. Empty keys are also rejected. Returns the cleaned key
 * (no leading `./`).
 */
function validateKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new Error(`storage: invalid key (empty)`);
  }
  if (key.startsWith('/') || key.startsWith('\\')) {
    throw new Error(`storage: invalid key (absolute): ${key}`);
  }
  // Normalize POSIX-style. We don't allow back-references regardless of
  // platform separator.
  const parts = key.split(/[\\/]+/);
  if (parts.some((p) => p === '..')) {
    throw new Error(`storage: invalid key (directory escape): ${key}`);
  }
  // Strip a leading "./" if present.
  return key.replace(/^\.\//, '');
}

// ───────────────────────────────────────────────────────────────────────────
// LocalStorage — filesystem backend (default).
// ───────────────────────────────────────────────────────────────────────────

export class LocalStorage implements Storage {
  constructor(private readonly rootPath: string) {}

  private resolveKey(key: string): string {
    const cleaned = validateKey(key);
    return path.join(this.rootPath, cleaned);
  }

  async put(
    key: string,
    body: Buffer | NodeJS.ReadableStream,
    _opts?: PutOptions,
  ): Promise<{ key: string; size: number }> {
    const cleaned = validateKey(key);
    const target = path.join(this.rootPath, cleaned);
    await fs.mkdir(path.dirname(target), { recursive: true });

    if (Buffer.isBuffer(body)) {
      await fs.writeFile(target, body);
      return { key: cleaned, size: body.byteLength };
    }
    // Stream → write via pipeline so backpressure is honored.
    const ws = createWriteStream(target);
    await pipeline(body as Readable, ws);
    const stat = await fs.stat(target);
    return { key: cleaned, size: stat.size };
  }

  async get(
    key: string,
  ): Promise<{
    stream: NodeJS.ReadableStream;
    size: number;
    contentType?: string;
  }> {
    const target = this.resolveKey(key);
    const stat = await fs.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new Error(`storage: key not found: ${key}`);
    }
    return { stream: createReadStream(target), size: stat.size };
  }

  async exists(key: string): Promise<boolean> {
    try {
      const target = this.resolveKey(key);
      const stat = await fs.stat(target);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.resolveKey(key);
    await fs.rm(target, { force: true });
  }

  async stat(key: string): Promise<StorageObject | null> {
    try {
      const cleaned = validateKey(key);
      const target = path.join(this.rootPath, cleaned);
      const st = await fs.stat(target);
      if (!st.isFile()) return null;
      return {
        key: cleaned,
        size: st.size,
        lastModified: st.mtime,
      };
    } catch {
      return null;
    }
  }

  async list(
    prefix: string,
    opts?: ListOptions,
  ): Promise<{ items: StorageObject[]; nextCursor?: string }> {
    // Walk the rootPath collecting files whose relative path starts with
    // `prefix`. We canonicalize separators to '/' so list returns keys that
    // round-trip through `get` regardless of OS.
    const root = this.rootPath;
    const items: StorageObject[] = [];
    const limit = opts?.limit ?? 1000;
    const cursor = opts?.cursor; // last key returned in previous page

    async function walk(dir: string): Promise<void> {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return;
        throw err;
      }
      // Sort for deterministic ordering — pagination depends on it.
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const ent of entries) {
        if (items.length >= limit) return;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(full);
        } else if (ent.isFile()) {
          const rel = path.relative(root, full).split(path.sep).join('/');
          if (prefix && !rel.startsWith(prefix)) continue;
          if (cursor && rel <= cursor) continue;
          const st = await fs.stat(full);
          items.push({
            key: rel,
            size: st.size,
            lastModified: st.mtime,
          });
          if (items.length >= limit) return;
        }
      }
    }

    await walk(root);

    const nextCursor =
      items.length === limit ? items[items.length - 1]?.key : undefined;
    return { items, nextCursor };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// S3Storage — @aws-sdk/client-s3 backend (works against MinIO too).
// ───────────────────────────────────────────────────────────────────────────

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

/**
 * Lazy import of the AWS SDK so worker startups that use the Local driver
 * never pay the SDK's parsing cost (the AWS client tree is large).
 */
async function loadS3Sdk(): Promise<{
  S3Client: typeof import('@aws-sdk/client-s3').S3Client;
  PutObjectCommand: typeof import('@aws-sdk/client-s3').PutObjectCommand;
  GetObjectCommand: typeof import('@aws-sdk/client-s3').GetObjectCommand;
  HeadObjectCommand: typeof import('@aws-sdk/client-s3').HeadObjectCommand;
  DeleteObjectCommand: typeof import('@aws-sdk/client-s3').DeleteObjectCommand;
  ListObjectsV2Command: typeof import('@aws-sdk/client-s3').ListObjectsV2Command;
}> {
  const mod = await import('@aws-sdk/client-s3');
  return {
    S3Client: mod.S3Client,
    PutObjectCommand: mod.PutObjectCommand,
    GetObjectCommand: mod.GetObjectCommand,
    HeadObjectCommand: mod.HeadObjectCommand,
    DeleteObjectCommand: mod.DeleteObjectCommand,
    ListObjectsV2Command: mod.ListObjectsV2Command,
  };
}

export class S3Storage implements Storage {
  private clientPromise:
    | Promise<import('@aws-sdk/client-s3').S3Client>
    | undefined;
  private sdkPromise: ReturnType<typeof loadS3Sdk> | undefined;

  constructor(private readonly config: S3Config) {}

  private async sdk() {
    if (!this.sdkPromise) {
      this.sdkPromise = loadS3Sdk();
    }
    return this.sdkPromise;
  }

  private async client(): Promise<import('@aws-sdk/client-s3').S3Client> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { S3Client } = await this.sdk();
        const credentials =
          this.config.accessKeyId && this.config.secretAccessKey
            ? {
                accessKeyId: this.config.accessKeyId,
                secretAccessKey: this.config.secretAccessKey,
              }
            : undefined;
        return new S3Client({
          region: this.config.region,
          endpoint: this.config.endpoint,
          credentials,
          forcePathStyle: this.config.forcePathStyle ?? false,
        });
      })();
    }
    return this.clientPromise;
  }

  async put(
    key: string,
    body: Buffer | NodeJS.ReadableStream,
    opts?: PutOptions,
  ): Promise<{ key: string; size: number }> {
    const cleaned = validateKey(key);
    const { PutObjectCommand } = await this.sdk();
    const client = await this.client();

    // S3 SDK requires Buffer or a sized Node Readable for streaming uploads.
    // If we got a stream without `opts.size`, buffer it — multipart upload is
    // tracked as a follow-up. Buffering only matters for large objects;
    // thumbnails / DXF / PDFs in the worker are small.
    let putBody: Buffer | Readable;
    let size: number;
    if (Buffer.isBuffer(body)) {
      putBody = body;
      size = body.byteLength;
    } else if (typeof opts?.size === 'number') {
      putBody = toNodeReadable(body);
      size = opts.size;
    } else {
      const buf = await readStreamToBuffer(toNodeReadable(body));
      putBody = buf;
      size = buf.byteLength;
    }

    await client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: cleaned,
        Body: putBody,
        ContentType: opts?.contentType,
        ContentLength: size,
      }),
    );
    return { key: cleaned, size };
  }

  async get(
    key: string,
  ): Promise<{
    stream: NodeJS.ReadableStream;
    size: number;
    contentType?: string;
  }> {
    const cleaned = validateKey(key);
    const { GetObjectCommand } = await this.sdk();
    const client = await this.client();
    const out = await client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: cleaned }),
    );
    const body = out.Body;
    if (!body) {
      throw new Error(`storage: key not found: ${key}`);
    }
    // In Node the SDK Body is a Readable. Cast accordingly.
    return {
      stream: body as NodeJS.ReadableStream,
      size: out.ContentLength ?? 0,
      contentType: out.ContentType,
    };
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    const cleaned = validateKey(key);
    const { DeleteObjectCommand } = await this.sdk();
    const client = await this.client();
    await client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: cleaned }),
    );
  }

  async stat(key: string): Promise<StorageObject | null> {
    const cleaned = validateKey(key);
    const { HeadObjectCommand } = await this.sdk();
    const client = await this.client();
    try {
      const out = await client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: cleaned }),
      );
      return {
        key: cleaned,
        size: out.ContentLength ?? 0,
        lastModified: out.LastModified ?? new Date(0),
        contentType: out.ContentType,
      };
    } catch (err) {
      // S3 SDK throws NotFound (404) for missing keys.
      const name = (err as { name?: string })?.name;
      const statusCode = (err as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (name === 'NotFound' || statusCode === 404) return null;
      throw err;
    }
  }

  async list(
    prefix: string,
    opts?: ListOptions,
  ): Promise<{ items: StorageObject[]; nextCursor?: string }> {
    const { ListObjectsV2Command } = await this.sdk();
    const client = await this.client();
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix || undefined,
        MaxKeys: opts?.limit ?? 1000,
        ContinuationToken: opts?.cursor,
      }),
    );
    const items: StorageObject[] = (out.Contents ?? [])
      .filter((c) => c.Key !== undefined)
      .map((c) => ({
        key: c.Key as string,
        size: c.Size ?? 0,
        lastModified: c.LastModified ?? new Date(0),
      }));
    return {
      items,
      nextCursor: out.IsTruncated ? out.NextContinuationToken : undefined,
    };
  }
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Coerce a generic `NodeJS.ReadableStream` into a Node `Readable`. The two
 * are runtime-equivalent in Node (Readable implements ReadableStream), but
 * TS types differ — the AWS SDK's `Body` parameter narrows to Node's
 * `Readable | Blob | Buffer | string | Uint8Array`.
 */
function toNodeReadable(stream: NodeJS.ReadableStream): Readable {
  if (stream instanceof Readable) return stream;
  return Readable.from(stream as AsyncIterable<unknown>);
}

// ───────────────────────────────────────────────────────────────────────────
// Factory — singleton accessor reading env on first call.
// ───────────────────────────────────────────────────────────────────────────

let cached: Storage | undefined;

/**
 * Return the worker's storage singleton. Driver is decided once on first
 * call from `STORAGE_DRIVER` (default `'local'`). Subsequent calls return
 * the same instance.
 *
 * Env vars (mirrors apps/web/lib/storage):
 *   STORAGE_DRIVER          local | s3              (default: local)
 *   FILE_STORAGE_ROOT       e.g. ./.data/files      (local)
 *   S3_ENDPOINT             e.g. http://minio:9000  (s3)
 *   S3_REGION               e.g. us-east-1          (s3)
 *   S3_BUCKET               e.g. drawing-mgmt       (s3, required)
 *   S3_ACCESS_KEY_ID        (s3, optional — falls back to AWS default chain)
 *   S3_SECRET_ACCESS_KEY    (s3, optional)
 *   S3_FORCE_PATH_STYLE     1 | 0                   (s3, default 1 for MinIO)
 */
export function getStorage(): Storage {
  if (cached) return cached;
  cached = createStorage(readConfigFromEnv());
  return cached;
}

/** Exposed for tests — bypasses the singleton cache. */
export function createStorage(config: StorageDriverConfig): Storage {
  if (config.driver === 's3') {
    if (!config.bucket) {
      throw new Error('storage: S3 driver requires bucket');
    }
    return new S3Storage({
      endpoint: config.endpoint,
      region: config.region ?? 'us-east-1',
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: config.forcePathStyle ?? true,
    });
  }
  const root = path.resolve(config.rootPath ?? './.data/files');
  return new LocalStorage(root);
}

function readConfigFromEnv(): StorageDriverConfig {
  const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  if (driver === 's3') {
    return {
      driver: 's3',
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? '',
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== '0',
    };
  }
  return {
    driver: 'local',
    rootPath: process.env.FILE_STORAGE_ROOT ?? './.data/files',
  };
}

/** Test-only: clears the singleton so the next `getStorage()` re-reads env. */
export function _resetStorageForTests(): void {
  cached = undefined;
}
