// Upload store — filesystem helper for V-INF-2 chunked uploads.
//
// Each in-progress Upload row is paired with a single temp file at
// `<UPLOAD_TMP_ROOT>/<id>.bin`. Chunks are appended to that file; on
// finalize we move/copy the bytes into the regular attachment storage
// layout. Cancel deletes the temp file.
//
// Why a dedicated helper:
//   - Centralizes the path resolution so route handlers can't accidentally
//     escape the upload root via path traversal.
//   - Wraps the append + size check in a single function so concurrent
//     PATCH calls on the same upload don't get interleaved (the
//     `appendChunk` call is serialized via a per-upload async lock).
//   - Hides the `flag: 'a'` open semantics + the offset-equals-size guard
//     so the route handler stays focused on auth/perm/state.
//
// R34 V-INF-1 — *staging stays local even when STORAGE_DRIVER=s3*. Reasons:
//   - S3 doesn't support byte-level append; emulating it would require
//     either multipart upload sessions per chunk (costly small parts) or
//     re-uploading the whole object on every PATCH.
//   - Chunked uploads are short-lived (1 day TTL) and bounded (200 MB cap;
//     R49 / FIND-011 — was 2 GB, narrowed to TRD §6's 200 MB), so local
//     disk is the right scratch space.
//   - On finalize (POST .../finalize) we hand the assembled buffer to
//     `getStorage().put(...)` — that's where the driver boundary actually
//     matters.

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Root directory for temporary upload chunks. Resolved once on module
 * load; if it's a relative path it's anchored to `process.cwd()`.
 *
 * Default `./.data/uploads` mirrors the convention used by
 * `FILE_STORAGE_ROOT` in `attachments/route.ts`.
 */
const UPLOAD_TMP_ROOT = path.isAbsolute(process.env.UPLOAD_TMP_ROOT ?? '')
  ? path.resolve(process.env.UPLOAD_TMP_ROOT!)
  : path.resolve(
      process.cwd(),
      process.env.UPLOAD_TMP_ROOT ?? './.data/uploads',
    );

/** 5 MB — recommended chunk size returned by `POST /api/v1/uploads`. */
export const RECOMMENDED_CHUNK_SIZE = 5_000_000;

/**
 * Hard ceiling for a single upload session.
 *
 * R49 / FIND-011 — TRD §6 specifies a 200 MB cap; the prior 2 GiB constant
 * was an oversight that allowed gigabyte uploads to consume disk + worker
 * time before being rejected downstream. Configurable via
 * `ATTACHMENT_MAX_BYTES` so deployments can tune up/down without a code
 * change; the multipart route at `/api/v1/objects/[id]/attachments` reads
 * the same env var to keep both ingest paths in lockstep.
 */
export const MAX_UPLOAD_BYTES = parseInt(
  process.env.ATTACHMENT_MAX_BYTES ?? String(200 * 1024 * 1024),
  10,
);

/** Hard ceiling for one chunk to avoid a single PATCH OOMing the server. */
export const MAX_CHUNK_BYTES = 32 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────
// Per-upload async lock — serializes concurrent PATCH calls
// targeting the same upload id so two appends can't race on the
// same file descriptor / size check.
// ─────────────────────────────────────────────────────────────
const locks = new Map<string, Promise<void>>();

async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => next);
  locks.set(id, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(id) === chained) locks.delete(id);
  }
}

// ─────────────────────────────────────────────────────────────
// Path helpers — never expose the raw filesystem path; callers
// receive the on-disk path only after we've validated the id.
// ─────────────────────────────────────────────────────────────
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_\-]+$/.test(id);
}

/**
 * Absolute path for an upload's temp chunk file. Throws if the id contains
 * unexpected characters (path traversal defense).
 */
export function uploadStoragePath(id: string): string {
  if (!isSafeId(id)) {
    throw new Error(`upload-store: invalid id "${id}"`);
  }
  return path.join(UPLOAD_TMP_ROOT, `${id}.bin`);
}

/** Ensure `UPLOAD_TMP_ROOT` exists. Cheap (mkdir -p semantics). */
export async function ensureUploadRoot(): Promise<void> {
  await fs.mkdir(UPLOAD_TMP_ROOT, { recursive: true });
}

// ─────────────────────────────────────────────────────────────
// Reservation: create the empty backing file so subsequent
// appends always have a target. Idempotent — re-creating an
// existing reservation is a no-op (we don't truncate).
// ─────────────────────────────────────────────────────────────
export async function reserveUpload(id: string): Promise<string> {
  const filePath = uploadStoragePath(id);
  await ensureUploadRoot();
  // 'a' (append) creates the file when missing; closing the handle
  // immediately leaves a 0-byte file ready for chunk appends.
  const handle = await fs.open(filePath, 'a');
  await handle.close();
  return filePath;
}

// ─────────────────────────────────────────────────────────────
// Append a chunk at the expected offset. Returns the new size.
// Caller is responsible for updating the Upload row in the same
// transaction.
//
// Validation rules:
//   - offset must equal the current file size (no overwriting,
//     no gaps).
//   - new size must not exceed totalBytes.
//   - chunk size must be > 0 and <= MAX_CHUNK_BYTES.
// ─────────────────────────────────────────────────────────────
export interface AppendChunkInput {
  id: string;
  expectedOffset: number;
  chunk: Buffer;
  totalBytes: number;
}

export interface AppendChunkResult {
  newSize: number;
}

export async function appendChunk(
  input: AppendChunkInput,
): Promise<AppendChunkResult> {
  const { id, expectedOffset, chunk, totalBytes } = input;
  if (chunk.byteLength === 0) {
    throw new UploadStoreError('EMPTY_CHUNK', '빈 청크는 허용되지 않습니다.');
  }
  if (chunk.byteLength > MAX_CHUNK_BYTES) {
    throw new UploadStoreError(
      'CHUNK_TOO_LARGE',
      `청크 크기가 너무 큽니다 (max ${MAX_CHUNK_BYTES} bytes).`,
    );
  }

  return withLock(id, async () => {
    const filePath = uploadStoragePath(id);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      throw new UploadStoreError(
        'NOT_RESERVED',
        '업로드 임시 파일이 존재하지 않습니다.',
      );
    }
    const currentSize = stat.size;
    if (expectedOffset !== currentSize) {
      throw new UploadStoreError(
        'OFFSET_MISMATCH',
        `offset 불일치 (expected=${currentSize}, got=${expectedOffset}).`,
        { expected: currentSize, got: expectedOffset },
      );
    }
    if (currentSize + chunk.byteLength > totalBytes) {
      throw new UploadStoreError(
        'EXCEEDS_TOTAL',
        `총 크기를 초과합니다 (totalBytes=${totalBytes}).`,
        { totalBytes, attempted: currentSize + chunk.byteLength },
      );
    }

    // Append. Open with flag 'a' so we never accidentally overwrite.
    const handle = await fs.open(filePath, 'a');
    try {
      await handle.write(chunk);
    } finally {
      await handle.close();
    }

    return { newSize: currentSize + chunk.byteLength };
  });
}

// ─────────────────────────────────────────────────────────────
// Delete the temp file. Used by cancel + finalize cleanup.
// Missing file is treated as success (idempotent).
// ─────────────────────────────────────────────────────────────
export async function deleteUpload(id: string): Promise<void> {
  const filePath = uploadStoragePath(id);
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    /* ignore — best effort */
  }
}

// ─────────────────────────────────────────────────────────────
// Read the upload's temp file as a Buffer. Used by finalize() to
// produce the SHA-256 + write into the attachment storage. Note:
// for very large uploads this loads the whole file into memory;
// the default cap is 200 MB (R49 / FIND-011) which fits comfortably,
// but if `ATTACHMENT_MAX_BYTES` is raised significantly the caller
// should consider streaming.
// ─────────────────────────────────────────────────────────────
export async function readUploadBuffer(id: string): Promise<Buffer> {
  return fs.readFile(uploadStoragePath(id));
}

/**
 * Stat the temp file. Returns null if the file doesn't exist (e.g. cleanup
 * already ran or the upload was reserved but never received a chunk).
 */
export async function statUpload(
  id: string,
): Promise<{ size: number } | null> {
  try {
    const s = await fs.stat(uploadStoragePath(id));
    return { size: s.size };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────
export type UploadStoreErrorCode =
  | 'NOT_RESERVED'
  | 'OFFSET_MISMATCH'
  | 'EXCEEDS_TOTAL'
  | 'EMPTY_CHUNK'
  | 'CHUNK_TOO_LARGE';

export class UploadStoreError extends Error {
  constructor(
    public code: UploadStoreErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'UploadStoreError';
  }
}
