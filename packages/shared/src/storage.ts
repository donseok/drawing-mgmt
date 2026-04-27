// R34 V-INF-1 — Storage abstraction interface.
//
// Both apps/web Route Handlers and apps/worker BullMQ workers go through this
// interface, so swapping the on-disk LocalStorage for S3/MinIO is a deploy-
// time decision (env STORAGE_DRIVER=s3) instead of a code change. The two
// drivers in apps/web/lib/storage/{local,s3}.ts implement this contract; the
// factory `getStorage()` picks one at boot.
//
// Why live in @drawing-mgmt/shared:
//   - The worker imports the same interface so a single migration commits
//     keep web + worker in lockstep without duplicate type definitions.
//   - Pure types/interface only — zero runtime dependency, zero side effects
//     so it stays cheap to import from any package.
//
// Key conventions (driver-agnostic):
//   - `key` = path-style identifier under the storage root / bucket.
//     Forward slashes only. No leading slash. Examples used by R34 callers:
//       <attachmentId>/source.<ext>
//       <attachmentId>/preview.dxf
//       <attachmentId>/preview.pdf
//       <attachmentId>/thumbnail.png
//       <attachmentId>/print-<ctb>-<pageSize>.pdf
//   - `put` accepts Buffer or stream; size is optional but improves S3
//     uploads (avoids buffering the full payload to compute Content-Length).
//   - `get` returns a Node Readable stream so callers can pipe directly into
//     a Response without buffering large originals (DWGs hit hundreds of MB).
//   - `getSignedUrl` is optional — LocalStorage exposes the file via Route
//     Handlers and never issues signed URLs. S3Storage implements it for
//     direct downloads/uploads.

export interface StorageObject {
  /** Path-style key of the object (no leading slash). */
  key: string;
  /** Size in bytes. */
  size: number;
  /** Last modification time. For LocalStorage this is mtime; for S3 it's the
   * `LastModified` header from `HeadObject`. */
  lastModified: Date;
  /** Optional MIME type. S3 returns this from object metadata; LocalStorage
   * leaves it undefined (callers fall back to filename-based guesses). */
  contentType?: string;
}

export interface StoragePutOptions {
  /** Override the stored Content-Type. Drivers that lack metadata (Local)
   * may ignore this. */
  contentType?: string;
  /** Hint the byte length so streaming uploads don't have to buffer. */
  size?: number;
}

export interface StoragePutResult {
  key: string;
  size: number;
}

export interface StorageGetResult {
  /** Node Readable stream. Caller is responsible for consuming or destroying.
   * For local files this is a `fs.createReadStream`; for S3 it's the body
   * stream of `GetObjectCommand`. */
  stream: NodeJS.ReadableStream;
  size: number;
  contentType?: string;
  lastModified?: Date;
}

export interface StorageListOptions {
  /** Max items per page. Drivers may cap this. */
  limit?: number;
  /** Opaque continuation token returned by the previous `list()` call. */
  cursor?: string;
}

export interface StorageListResult {
  items: StorageObject[];
  /** Continuation token for the next page; absent when the listing is done. */
  nextCursor?: string;
}

export interface StorageSignedUrlOptions {
  /** Seconds the URL is valid for. Default 5 minutes. */
  expiresIn?: number;
  /** GET (default) for downloads, PUT for direct browser uploads. */
  method?: 'GET' | 'PUT';
}

export interface Storage {
  put(
    key: string,
    body: Buffer | NodeJS.ReadableStream,
    opts?: StoragePutOptions,
  ): Promise<StoragePutResult>;
  get(key: string): Promise<StorageGetResult>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Returns null if the object does not exist (no throw). */
  stat(key: string): Promise<StorageObject | null>;
  list(prefix: string, opts?: StorageListOptions): Promise<StorageListResult>;
  /** Optional — drivers without signed-URL support omit this. */
  getSignedUrl?(
    key: string,
    opts?: StorageSignedUrlOptions,
  ): Promise<string>;
}

/**
 * Driver-agnostic configuration. Each driver picks the fields it needs and
 * ignores the rest; the factory in `apps/web/lib/storage/index.ts` reads the
 * matching env vars to populate it.
 */
export interface StorageDriverConfig {
  driver: 'local' | 's3';
  // local-only
  rootPath?: string;
  // s3-only
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** MinIO requires path-style URLs (`http://host/bucket/key` instead of
   * virtual-hosted `http://bucket.host/key`). Default false (AWS). */
  forcePathStyle?: boolean;
}

/**
 * Error thrown when a key is malformed or escapes the storage root. Callers
 * should treat this as a 400 (validation) and log the offending key so we
 * can spot path-traversal attempts.
 */
export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageKeyError';
  }
}

/**
 * Error thrown when a key does not exist. Used by `get()` so callers can
 * map it to 404 without inspecting driver-specific error codes.
 */
export class StorageNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`storage: key not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}
