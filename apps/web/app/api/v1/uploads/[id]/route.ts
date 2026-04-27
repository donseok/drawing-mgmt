// PATCH /api/v1/uploads/{id} — append a chunk to an in-progress upload.
// DELETE /api/v1/uploads/{id} — cancel an upload (delete temp file + mark FAILED).
//
// R31 / V-INF-2 — chunked upload session step + cancel.
//
// PATCH semantics (mirror well-known protocols like tus):
//   - Body: binary (octet-stream OR multipart with `chunk` field).
//   - Header: `X-Chunk-Offset: <bytes>` — must equal the upload's current
//     uploadedBytes. Mismatch returns E_VALIDATION with details so the
//     client can resync.
//   - On success: row's `uploadedBytes` advances, `status` flips to
//     IN_PROGRESS (from PENDING).
//
// Authorization: only the upload owner (or admin) can mutate it.

import { NextResponse } from 'next/server';
import { Prisma, UploadStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import {
  appendChunk,
  deleteUpload,
  UploadStoreError,
} from '@/lib/upload-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

interface UploadRow {
  id: string;
  userId: string;
  status: UploadStatus;
  totalBytes: bigint;
  uploadedBytes: bigint;
  expiresAt: Date;
}

async function loadOwned(
  id: string,
  userId: string,
  role: string,
): Promise<UploadRow | null> {
  const row = await prisma.upload.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      totalBytes: true,
      uploadedBytes: true,
      expiresAt: true,
    },
  });
  if (!row) return null;
  if (row.userId !== userId && !isAdmin(role)) return null;
  return row;
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH — append a chunk
// ─────────────────────────────────────────────────────────────────────────
export const PATCH = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req, { params }): Promise<NextResponse> => {
    let user;
    try {
      user = await requireUser();
    } catch (err) {
      if (err instanceof Response) return err as NextResponse;
      throw err;
    }

    const row = await loadOwned(params.id, user.id, user.role);
    if (!row) return error(ErrorCode.E_NOT_FOUND);

    if (
      row.status === UploadStatus.COMPLETED ||
      row.status === UploadStatus.FAILED ||
      row.status === UploadStatus.EXPIRED
    ) {
      return error(
        ErrorCode.E_STATE_CONFLICT,
        '업로드가 이미 종료된 상태입니다.',
      );
    }
    if (row.expiresAt.getTime() < Date.now()) {
      // Mark expired then refuse — keeps cleanup in sync with realtime use.
      await prisma.upload
        .update({
          where: { id: row.id },
          data: { status: UploadStatus.EXPIRED },
        })
        .catch(() => undefined);
      return error(ErrorCode.E_STATE_CONFLICT, '업로드 세션이 만료되었습니다.');
    }

    // Parse offset header — required, must be a non-negative integer.
    const offsetHeader = req.headers.get('x-chunk-offset');
    const offset =
      offsetHeader === null ? null : Number.parseInt(offsetHeader, 10);
    if (offset === null || !Number.isFinite(offset) || offset < 0) {
      return error(
        ErrorCode.E_VALIDATION,
        'X-Chunk-Offset 헤더가 필요합니다.',
      );
    }

    // Read the chunk. Support both octet-stream (preferred) and multipart
    // (so curl/form-based testing works).
    const ct = req.headers.get('content-type') ?? '';
    let chunk: Buffer;
    try {
      if (ct.toLowerCase().includes('multipart/form-data')) {
        const form = await req.formData();
        const part = form.get('chunk');
        if (!(part instanceof File)) {
          return error(
            ErrorCode.E_VALIDATION,
            'multipart 본문에 chunk 필드가 없습니다.',
          );
        }
        chunk = Buffer.from(await part.arrayBuffer());
      } else {
        const ab = await req.arrayBuffer();
        chunk = Buffer.from(ab);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return error(ErrorCode.E_VALIDATION, '청크 본문 파싱 실패: ' + message);
    }

    const totalBytes = Number(row.totalBytes);
    const uploadedBefore = Number(row.uploadedBytes);
    if (offset !== uploadedBefore) {
      return error(
        ErrorCode.E_VALIDATION,
        `offset 불일치 (expected=${uploadedBefore}, got=${offset}).`,
        undefined,
        { expected: uploadedBefore, got: offset },
      );
    }

    let newSize: number;
    try {
      const result = await appendChunk({
        id: row.id,
        expectedOffset: offset,
        chunk,
        totalBytes,
      });
      newSize = result.newSize;
    } catch (err) {
      if (err instanceof UploadStoreError) {
        // OFFSET_MISMATCH (race), EMPTY_CHUNK, EXCEEDS_TOTAL — all 400-ish.
        return error(
          ErrorCode.E_VALIDATION,
          err.message,
          undefined,
          err.details,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return error(ErrorCode.E_INTERNAL, '청크 저장 실패: ' + message);
    }

    // Advance the row. Guarded update (uploadedBytes = expected value) so a
    // concurrent PATCH that snuck past our in-process lock can't double-count.
    const updated = await prisma.upload.updateMany({
      where: { id: row.id, uploadedBytes: row.uploadedBytes },
      data: {
        uploadedBytes: BigInt(newSize),
        status: UploadStatus.IN_PROGRESS,
      },
    });
    if (updated.count === 0) {
      const fresh = await prisma.upload.findUnique({
        where: { id: row.id },
        select: { uploadedBytes: true, totalBytes: true },
      });
      return error(
        ErrorCode.E_VALIDATION,
        '동시 업로드가 감지되어 청크를 거부했습니다.',
        undefined,
        {
          expected: fresh ? Number(fresh.uploadedBytes) : null,
        },
      );
    }

    return ok({
      uploadedBytes: newSize.toString(),
      totalBytes: totalBytes.toString(),
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────
// DELETE — cancel an upload
// ─────────────────────────────────────────────────────────────────────────
export const DELETE = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (_req, { params }): Promise<NextResponse> => {
    let user;
    try {
      user = await requireUser();
    } catch (err) {
      if (err instanceof Response) return err as NextResponse;
      throw err;
    }

    const row = await loadOwned(params.id, user.id, user.role);
    if (!row) return error(ErrorCode.E_NOT_FOUND);

    if (row.status === UploadStatus.COMPLETED) {
      return error(
        ErrorCode.E_STATE_CONFLICT,
        '이미 완료된 업로드는 취소할 수 없습니다.',
      );
    }

    await deleteUpload(row.id);
    await prisma.upload
      .update({
        where: { id: row.id },
        data: {
          status: UploadStatus.FAILED,
          errorMessage: 'cancelled by user',
        },
      })
      .catch((err: unknown) => {
        if (
          !(
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2025'
          )
        ) {
          // eslint-disable-next-line no-console
          console.error('[uploads] cancel update failed', err);
        }
      });

    return ok({ uploadId: row.id, status: UploadStatus.FAILED });
  },
);
