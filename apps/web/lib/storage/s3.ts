// S3Storage driver — `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
//
// Compatible with both AWS S3 and MinIO (S3 API). MinIO needs
// `forcePathStyle: true` because it serves buckets at the path level instead
// of subdomains. The factory in `./index.ts` flips that on for on-prem.
//
// Key conventions match LocalStorage exactly so the underlying
// `Attachment.storagePath` value is portable across drivers — admins can
// migrate (LOCAL → S3) by copying the directory tree into the bucket
// without rewriting the DB.
//
// What this driver intentionally doesn't do:
//   - No multipart uploads. Objects we put through here come from the chunk-
//     finalize step (already buffered to disk) or the worker (PDF/DXF/PNG —
//     all <50 MB). For larger originals we'd revisit and switch to
//     `@aws-sdk/lib-storage`'s `Upload`.
//   - No retries beyond the SDK defaults. The route handlers wrap calls in
//     try/catch and surface E_INTERNAL when needed; the worker is at-least-
//     once via BullMQ so transient S3 errors retry naturally.

import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
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
  StorageSignedUrlOptions,
} from '@drawing-mgmt/shared/storage';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** MinIO=true. AWS S3=false (default). */
  forcePathStyle?: boolean;
}

export class S3Storage implements Storage {
  private readonly client: S3Client;
  readonly bucket: string;
  readonly endpoint: string | undefined;
  readonly region: string;
  readonly forcePathStyle: boolean;

  constructor(config: S3StorageConfig) {
    if (!config.bucket) {
      throw new Error('S3Storage: bucket is required');
    }
    this.bucket = config.bucket;
    this.region = config.region;
    this.endpoint = config.endpoint;
    this.forcePathStyle = Boolean(config.forcePathStyle);

    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: this.forcePathStyle,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
    });
  }

  // ───────────────────────── put ─────────────────────────
  async put(
    key: string,
    body: Buffer | NodeJS.ReadableStream,
    opts: StoragePutOptions = {},
  ): Promise<StoragePutResult> {
    assertSafeKey(key);
    let putBody: Buffer | Readable;
    let size: number | undefined;

    if (Buffer.isBuffer(body)) {
      putBody = body;
      size = body.byteLength;
    } else {
      // S3 PutObject needs a Readable, not just any stream — wrap
      // node:stream Readables that already are, leave them otherwise.
      putBody = body instanceof Readable ? body : Readable.from(body);
      size = opts.size;
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: putBody,
        ContentType: opts.contentType,
        ContentLength: size,
      }),
    );

    // We can't always know size for streamed writes without a HEAD round-
    // trip; if size wasn't supplied we issue a stat to surface the truth.
    if (size === undefined) {
      const stat = await this.stat(key);
      size = stat?.size ?? 0;
    }
    return { key, size };
  }

  // ───────────────────────── get ─────────────────────────
  async get(key: string): Promise<StorageGetResult> {
    assertSafeKey(key);
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = out.Body;
      if (!body) {
        throw new StorageNotFoundError(key);
      }
      // The SDK returns a web ReadableStream in some runtimes and a Node
      // Readable in others. Normalize to Node Readable for our callers.
      const stream =
        body instanceof Readable
          ? body
          : Readable.fromWeb(body as unknown as import('node:stream/web').ReadableStream<Uint8Array>);
      return {
        stream,
        size: Number(out.ContentLength ?? 0),
        contentType: out.ContentType,
        lastModified: out.LastModified,
      };
    } catch (err) {
      if (isNotFound(err)) throw new StorageNotFoundError(key);
      throw err;
    }
  }

  // ───────────────────────── exists / delete ─────────────────────────
  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  // ───────────────────────── stat ─────────────────────────
  async stat(key: string): Promise<StorageObject | null> {
    assertSafeKey(key);
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        size: Number(out.ContentLength ?? 0),
        lastModified: out.LastModified ?? new Date(0),
        contentType: out.ContentType,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  // ───────────────────────── list ─────────────────────────
  async list(
    prefix: string,
    opts: StorageListOptions = {},
  ): Promise<StorageListResult> {
    const limit = Math.max(1, Math.min(opts.limit ?? 1000, 1000));
    const trimmed = prefix.replace(/^\/+/, '');
    if (trimmed) {
      // Allow trailing-slash directory prefixes.
      assertSafePrefix(trimmed);
    }

    const out = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: trimmed || undefined,
        ContinuationToken: opts.cursor,
        MaxKeys: limit,
      }),
    );

    const items: StorageObject[] = (out.Contents ?? []).map((o) => ({
      key: o.Key ?? '',
      size: Number(o.Size ?? 0),
      lastModified: o.LastModified ?? new Date(0),
    }));

    return {
      items,
      nextCursor: out.IsTruncated ? out.NextContinuationToken : undefined,
    };
  }

  // ───────────────────────── signed URL ─────────────────────────
  async getSignedUrl(
    key: string,
    opts: StorageSignedUrlOptions = {},
  ): Promise<string> {
    assertSafeKey(key);
    const expiresIn = opts.expiresIn ?? 5 * 60;
    const cmd =
      opts.method === 'PUT'
        ? new PutObjectCommand({ Bucket: this.bucket, Key: key })
        : new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return awsGetSignedUrl(this.client, cmd, { expiresIn });
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const SAFE_KEY = /^[A-Za-z0-9_./-]+$/;

function assertSafeKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new StorageKeyError('storage: empty key');
  }
  if (key.length > 1024) {
    throw new StorageKeyError('storage: key too long (max 1024)');
  }
  if (key.startsWith('/')) {
    throw new StorageKeyError(`storage: absolute key not allowed: ${key}`);
  }
  if (!SAFE_KEY.test(key)) {
    throw new StorageKeyError(`storage: key contains illegal characters: ${key}`);
  }
  for (const part of key.split('/')) {
    if (part === '..') {
      throw new StorageKeyError(`storage: '..' segment not allowed: ${key}`);
    }
    if (part === '') {
      throw new StorageKeyError(`storage: empty segment not allowed: ${key}`);
    }
  }
}

/** `assertSafeKey` allowing a trailing slash (directory prefix). */
function assertSafePrefix(prefix: string): void {
  const stripped = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  if (stripped) assertSafeKey(stripped);
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err instanceof S3ServiceException) {
    const name = err.name;
    return (
      name === 'NoSuchKey' ||
      name === 'NotFound' ||
      err.$metadata?.httpStatusCode === 404
    );
  }
  // Fallback for non-SDK errors that bubble up with status codes.
  const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return meta?.httpStatusCode === 404;
}
