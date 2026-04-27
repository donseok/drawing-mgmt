/**
 * R31 V-INF-2 — chunked upload helper.
 *
 * Splits a `File` into 5 MB chunks and ships each via PATCH /api/v1/uploads/{id}
 * with an `X-Chunk-Offset` header. Falls back to exponential backoff (200ms /
 * 800ms / 3.2s) on transient failures and trusts the BE's `uploadedBytes`
 * response as the resume cursor — so a network hiccup mid-chunk won't double-
 * append on retry.
 *
 * Three flow phases:
 *   1. POST   /api/v1/uploads               — register session, get uploadId/chunkSize
 *   2. PATCH  /api/v1/uploads/{id} (loop)   — append chunk, X-Chunk-Offset header
 *   3. POST   /api/v1/uploads/{id}/finalize — verify + materialize as Attachment
 *
 * On AbortSignal trip OR thrown error:
 *   - DELETE /api/v1/uploads/{id} fire-and-forget (cleanup so expiresAt
 *     doesn't have to do it).
 *
 * Used by `<AttachmentUploadDialog>` for files ≥ 5 MB. Smaller files keep the
 * legacy single-multipart flow (api_contract.md §5 + design_spec §B.1).
 */

const DEFAULT_CHUNK_SIZE = 5_000_000; // 5 MB — BE's recommended default.
const RETRY_BACKOFF_MS = [200, 800, 3200] as const;

// ── Public types ────────────────────────────────────────────────────────────

export interface ChunkUploadInitResponse {
  uploadId: string;
  /** BE-recommended chunk size in bytes. Helper honors it; defaults to 5 MB. */
  chunkSize: number;
}

export interface ChunkPatchResponse {
  uploadedBytes: number;
  totalBytes: number;
}

export interface ChunkFinalizeResponse {
  attachmentId: string;
  conversionJobId?: string;
}

export interface ChunkProgress {
  /** Total bytes confirmed by the server so far. Authoritative resume point. */
  uploadedBytes: number;
  totalBytes: number;
  /** Index of the chunk currently in flight (0-based). */
  chunkIdx: number;
  /** Total number of chunks. Stable across the upload. */
  chunkTotal: number;
}

export interface ChunkRetryEvent {
  /** 1-based attempt number (e.g. `1` = first retry). */
  attempt: number;
  /** Maximum attempts allowed (`retries`, default 3). */
  maxAttempts: number;
  /** Last error from the failed attempt. */
  cause: unknown;
}

export interface UploadInChunksOptions {
  /** Where to attach when finalize runs. Sent in finalize body. */
  objectId?: string;
  /** Reserved — finalize body. Phase 2 stand-alone uploads. */
  folderId?: string;
  /** Reserved — finalize body. Phase 2 class-typed stand-alone uploads. */
  classId?: string;
  /** When true, finalize body sets `asAttachment.isMaster = true`. */
  isMaster?: boolean;
  /**
   * Optional client-computed sha256 (hex). Forwarded to finalize for the BE
   * to verify against the stored bytes. We don't compute one by default —
   * hashing huge files in JS is expensive.
   */
  sha256?: string;

  /** AbortController.signal — aborts mid-chunk and triggers DELETE cleanup. */
  signal?: AbortSignal;

  /** Called whenever the BE confirms a new chunk. */
  onProgress?: (p: ChunkProgress) => void;
  /** Called with each PATCH retry attempt (after a transient failure). */
  onRetry?: (ev: ChunkRetryEvent) => void;

  /** Per-chunk retry budget (default 3 = 200ms / 800ms / 3.2s backoff). */
  retries?: number;
  /**
   * Override the BE's recommended chunkSize. Mainly useful for tests; in
   * production we honor the response from `POST /uploads`.
   */
  chunkSizeOverride?: number;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Lightweight error class. We don't use ApiError from `lib/api-client` because
 * the chunk PATCH ships a binary body via fetch directly (the wrapper would
 * JSON-stringify), so we own the error path here too.
 */
export class ChunkUploadError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  /** True when the failure looks recoverable (5xx / network / AbortError). */
  retriable: boolean;

  constructor(
    message: string,
    opts: {
      status?: number;
      code?: string;
      details?: unknown;
      retriable?: boolean;
    },
  ) {
    super(message);
    this.name = 'ChunkUploadError';
    this.status = opts.status ?? 0;
    this.code = opts.code;
    this.details = opts.details;
    this.retriable = opts.retriable ?? false;
  }
}

function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { name?: string }).name === 'AbortError'
  );
}

async function parseError(res: Response): Promise<ChunkUploadError> {
  const text = await res.text().catch(() => '');
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    // body wasn't JSON — fine, message stays HTTP-only.
  }
  const env = (parsed as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
  return new ChunkUploadError(env?.message ?? `Request failed (${res.status})`, {
    status: res.status,
    code: env?.code,
    details: env?.details,
    // Server 5xx + 408 + 429 are worth retrying. 4xx (other) is permanent.
    retriable: res.status >= 500 || res.status === 408 || res.status === 429,
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ── HTTP primitives ─────────────────────────────────────────────────────────

async function postInit(
  file: File,
  opts: UploadInChunksOptions,
): Promise<ChunkUploadInitResponse> {
  const res = await fetch('/api/v1/uploads', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      totalBytes: file.size,
      ...(opts.folderId ? { folderId: opts.folderId } : {}),
      ...(opts.classId ? { classId: opts.classId } : {}),
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw await parseError(res);
  const json = (await res.json()) as
    | { data: ChunkUploadInitResponse }
    | ChunkUploadInitResponse;
  // The BE wraps responses in `{ ok, data }`; tolerate both shapes.
  const init =
    'data' in (json as Record<string, unknown>)
      ? (json as { data: ChunkUploadInitResponse }).data
      : (json as ChunkUploadInitResponse);
  return {
    uploadId: init.uploadId,
    chunkSize:
      typeof init.chunkSize === 'number' && init.chunkSize > 0
        ? init.chunkSize
        : DEFAULT_CHUNK_SIZE,
  };
}

async function patchChunk(
  uploadId: string,
  offset: number,
  blob: Blob,
  signal?: AbortSignal,
): Promise<ChunkPatchResponse> {
  const res = await fetch(`/api/v1/uploads/${encodeURIComponent(uploadId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chunk-Offset': String(offset),
      Accept: 'application/json',
    },
    body: blob,
    signal,
  });
  if (!res.ok) throw await parseError(res);
  const json = (await res.json()) as
    | { data: ChunkPatchResponse }
    | ChunkPatchResponse;
  const data =
    'data' in (json as Record<string, unknown>)
      ? (json as { data: ChunkPatchResponse }).data
      : (json as ChunkPatchResponse);
  // BigInt sometimes serializes as string — coerce so progress math stays
  // numeric across the helper boundary.
  return {
    uploadedBytes: Number(data.uploadedBytes),
    totalBytes: Number(data.totalBytes),
  };
}

async function postFinalize(
  uploadId: string,
  opts: UploadInChunksOptions,
): Promise<ChunkFinalizeResponse> {
  const body: Record<string, unknown> = {};
  if (opts.objectId) body.objectId = opts.objectId;
  if (opts.isMaster !== undefined)
    body.asAttachment = { isMaster: !!opts.isMaster };
  if (opts.sha256) body.sha256 = opts.sha256;

  const res = await fetch(
    `/api/v1/uploads/${encodeURIComponent(uploadId)}/finalize`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    },
  );
  if (!res.ok) throw await parseError(res);
  const json = (await res.json()) as
    | { data: ChunkFinalizeResponse }
    | ChunkFinalizeResponse;
  return 'data' in (json as Record<string, unknown>)
    ? (json as { data: ChunkFinalizeResponse }).data
    : (json as ChunkFinalizeResponse);
}

/**
 * Best-effort cancel. We swallow the result — by the time we get here we're
 * already in an error/abort path, and `expiresAt` cleanup on the BE will
 * eventually claim orphans either way.
 */
export async function cancelUpload(uploadId: string): Promise<void> {
  try {
    await fetch(`/api/v1/uploads/${encodeURIComponent(uploadId)}`, {
      method: 'DELETE',
      credentials: 'include',
      // No `signal` on purpose — even if the user's controller already aborted,
      // we still want the cleanup ping to go out. Fire-and-forget.
      keepalive: true,
    });
  } catch {
    // ignore — see above.
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Stream `file` to `/api/v1/uploads` in 5 MB chunks. Resolves with the
 * finalized attachment id (and optional conversion job id when the BE
 * auto-enqueues a DXF/PDF conversion).
 *
 * On any failure or abort we DELETE the upload session so the BE can release
 * the temp blob immediately. The caller still gets the original error thrown.
 */
export async function uploadInChunks(
  file: File,
  opts: UploadInChunksOptions = {},
): Promise<ChunkFinalizeResponse> {
  if (file.size <= 0) {
    throw new ChunkUploadError('빈 파일은 업로드할 수 없습니다.', {
      status: 400,
      code: 'E_VALIDATION',
    });
  }
  const retries = opts.retries ?? 3;
  const signal = opts.signal;

  // 1. init session
  const init = await postInit(file, opts);
  const chunkSize =
    opts.chunkSizeOverride && opts.chunkSizeOverride > 0
      ? opts.chunkSizeOverride
      : init.chunkSize;
  const uploadId = init.uploadId;

  // 2. PATCH loop. We trust BE.uploadedBytes as the resume cursor; if the BE
  //    sends back an offset higher than ours (rare — a concurrent retry
  //    landing) we skip ahead. Lower (also rare — partial chunk) means we
  //    retry from the BE's offset with the matching slice.
  let cursor = 0;
  const totalBytes = file.size;
  const chunkTotal = Math.max(1, Math.ceil(totalBytes / chunkSize));

  try {
    while (cursor < totalBytes) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const end = Math.min(cursor + chunkSize, totalBytes);
      const blob = file.slice(cursor, end);
      const chunkIdx = Math.floor(cursor / chunkSize);

      let attempt = 0;
      let lastErr: unknown;
      // attempt 0 = first try; 1..retries = real retries.
      // The total tries cap is `retries + 1`.
      while (attempt <= retries) {
        try {
          const res = await patchChunk(uploadId, cursor, blob, signal);
          // Reset cursor to BE's authoritative value. Usually equals `end`.
          cursor = Math.max(cursor, res.uploadedBytes);
          opts.onProgress?.({
            uploadedBytes: res.uploadedBytes,
            totalBytes: res.totalBytes,
            chunkIdx,
            chunkTotal,
          });
          lastErr = undefined;
          break;
        } catch (err) {
          if (isAbortError(err)) throw err;
          lastErr = err;
          // Validation drift: BE expected a different offset. Resume from it.
          if (
            err instanceof ChunkUploadError &&
            err.code === 'E_VALIDATION' &&
            typeof (err.details as { expected?: number } | undefined)?.expected === 'number'
          ) {
            cursor = (err.details as { expected: number }).expected;
            // Don't count this against `attempts` — we corrected the offset.
            // Clear the error so the outer-loop guard doesn't re-throw, and
            // break out so we re-slice from the new cursor on the next iter.
            lastErr = undefined;
            attempt = 0;
            break;
          }
          // Permanent failure (4xx auth/permission/size) — give up immediately.
          if (err instanceof ChunkUploadError && !err.retriable) {
            throw err;
          }
          attempt++;
          if (attempt > retries) throw err;
          opts.onRetry?.({
            attempt,
            maxAttempts: retries,
            cause: err,
          });
          await delay(RETRY_BACKOFF_MS[attempt - 1] ?? 3200, signal);
        }
      }
      // Belt and suspenders: if the inner loop fell out without throwing AND
      // without resetting `lastErr`, we still want to escape gracefully.
      if (cursor < end && lastErr) throw lastErr;
    }

    // 3. finalize
    const result = await postFinalize(uploadId, opts);
    return result;
  } catch (err) {
    // Cleanup before re-throwing. Don't await — keepalive lets the request
    // survive even if the page is being torn down.
    void cancelUpload(uploadId);
    throw err;
  }
}
