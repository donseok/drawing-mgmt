// POST /api/v1/uploads
//
// R31 / V-INF-2 — initialize a chunked upload session.
//
// The client posts the filename + total size + mime type up front; we
// create an Upload row + reserve a 0-byte temp file at
// `<UPLOAD_TMP_ROOT>/<id>.bin`. Subsequent PATCH calls append chunks and
// the FE finally calls POST /uploads/:id/finalize to attach the bytes to
// an object.
//
// Auth: any logged-in user. The actual permission check (folder EDIT,
// object state) happens at finalize time so we don't reject in the middle
// of a long upload.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import {
  reserveUpload,
  uploadStoragePath,
  RECOMMENDED_CHUNK_SIZE,
  MAX_UPLOAD_BYTES,
} from '@/lib/upload-store';
// R49 / FIND-012 — narrow accepted client-claimed MIME types to the list
// the system actually serves; ClamAV (R36) still owns content-level safety.
import { ALLOWED_MIME_TYPES } from '@/lib/mime-allowed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** TTL for an in-progress upload session (24h). */
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

const bodySchema = z.object({
  filename: z.string().min(1).max(512),
  // R49 / FIND-012 — enum gate. Free-form `z.string()` previously let any
  // claimed type through; now the request fails fast for unsupported types
  // before the temp file is reserved.
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  totalBytes: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'string' ? Number(v) : v))
    .refine((n) => Number.isFinite(n) && n > 0, {
      message: 'totalBytes는 양의 숫자여야 합니다.',
    })
    .refine((n) => n <= MAX_UPLOAD_BYTES, {
      message: `totalBytes가 최대 한도(${MAX_UPLOAD_BYTES} bytes)를 초과합니다.`,
    }),
});

export const POST = withApi<unknown>(
  { rateLimit: 'api' },
  async (req): Promise<NextResponse> => {
    let user;
    try {
      user = await requireUser();
    } catch (err) {
      if (err instanceof Response) return err as NextResponse;
      throw err;
    }

    let body: z.infer<typeof bodySchema>;
    try {
      const raw = await req.json().catch(() => null);
      body = bodySchema.parse(raw);
    } catch (err) {
      return error(
        ErrorCode.E_VALIDATION,
        '업로드 초기화 입력이 올바르지 않습니다.',
        undefined,
        err instanceof z.ZodError ? err.flatten() : undefined,
      );
    }

    // Insert the row first so we have a stable id; then reserve the file.
    // If reserve() fails, we mark the row FAILED so admin sweeps catch it.
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
    const created = await prisma.upload.create({
      data: {
        userId: user.id,
        filename: body.filename,
        mimeType: body.mimeType,
        totalBytes: BigInt(body.totalBytes),
        storagePath: '', // filled in below — keep insert/update split simple
        status: 'PENDING',
        expiresAt,
      },
      select: { id: true },
    });

    try {
      await reserveUpload(created.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.upload
        .update({
          where: { id: created.id },
          data: { status: 'FAILED', errorMessage: message },
        })
        .catch(() => undefined);
      return error(
        ErrorCode.E_INTERNAL,
        '임시 파일 생성에 실패했습니다: ' + message,
      );
    }

    await prisma.upload.update({
      where: { id: created.id },
      data: { storagePath: uploadStoragePath(created.id) },
    });

    return ok(
      {
        uploadId: created.id,
        chunkSize: RECOMMENDED_CHUNK_SIZE,
        expiresAt: expiresAt.toISOString(),
      },
      undefined,
      { status: 201 },
    );
  },
);
