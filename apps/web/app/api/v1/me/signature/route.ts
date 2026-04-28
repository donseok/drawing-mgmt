// POST /api/v1/me/signature — upload user signature image.
// DELETE /api/v1/me/signature — remove user signature image.
//
// Accepted formats: image/png, image/jpeg. Max 2 MB.
// Storage: FILE_STORAGE_ROOT/signatures/{userId}/signature.{ext}

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg'] as const;

const STORAGE_ROOT = path.isAbsolute(process.env.FILE_STORAGE_ROOT ?? '')
  ? path.resolve(process.env.FILE_STORAGE_ROOT!)
  : path.resolve(
      process.cwd(),
      process.env.FILE_STORAGE_ROOT ?? './.data/files',
    );

function extForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    default:
      return '';
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/v1/me/signature — upload signature
// ─────────────────────────────────────────────────────────────
export const POST = withApi({ rateLimit: 'api' }, async (req: Request) => {
  let session;
  try {
    session = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().includes('multipart/form-data')) {
    return error(ErrorCode.E_VALIDATION, 'multipart/form-data가 필요합니다.');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return error(
      ErrorCode.E_VALIDATION,
      'multipart 파싱 실패: ' + (e instanceof Error ? e.message : '알 수 없음'),
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return error(ErrorCode.E_VALIDATION, 'file 필드가 필요합니다.');
  }
  if (file.size === 0) {
    return error(ErrorCode.E_VALIDATION, '빈 파일입니다.');
  }
  if (file.size > MAX_BYTES) {
    return error(
      ErrorCode.E_VALIDATION,
      `파일 크기 제한 초과 (최대 ${MAX_BYTES / 1024 / 1024}MB)`,
    );
  }

  const mime = file.type.toLowerCase();
  if (!ALLOWED_TYPES.includes(mime as (typeof ALLOWED_TYPES)[number])) {
    return error(
      ErrorCode.E_VALIDATION,
      'PNG 또는 JPEG 이미지만 업로드할 수 있습니다.',
    );
  }

  const ext = extForMime(mime);
  const sigDir = path.join(STORAGE_ROOT, 'signatures', session.id);
  await fs.mkdir(sigDir, { recursive: true });

  // Remove previous signature files in the directory (jpg/png swap case).
  try {
    const existing = await fs.readdir(sigDir);
    for (const f of existing) {
      if (f.startsWith('signature')) {
        await fs.unlink(path.join(sigDir, f)).catch(() => undefined);
      }
    }
  } catch {
    // Directory might not exist yet, ignore.
  }

  const filename = `signature${ext}`;
  const storedPath = path.join(sigDir, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storedPath, buf);

  const relativePath = `signatures/${session.id}/${filename}`;

  await prisma.user.update({
    where: { id: session.id },
    data: { signatureFile: relativePath },
  });

  return ok(
    { signatureFile: relativePath },
    undefined,
    { status: 201 },
  );
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/me/signature — remove signature
// ─────────────────────────────────────────────────────────────
export const DELETE = withApi({ rateLimit: 'api' }, async () => {
  let session;
  try {
    session = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { signatureFile: true },
  });

  if (!user) {
    return error(ErrorCode.E_NOT_FOUND, '사용자를 찾을 수 없습니다.');
  }

  // Delete the file from disk if it exists.
  if (user.signatureFile) {
    const fullPath = path.join(STORAGE_ROOT, user.signatureFile);
    await fs.unlink(fullPath).catch(() => undefined);
  }

  await prisma.user.update({
    where: { id: session.id },
    data: { signatureFile: null },
  });

  return ok({ message: '서명이 삭제되었습니다.' });
});
