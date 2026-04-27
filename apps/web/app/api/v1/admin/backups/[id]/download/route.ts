// GET /api/v1/admin/backups/{id}/download
//
// R33 / D-5 — streams the on-disk backup artifact for an admin to download.
// Only DONE rows are streamable; RUNNING/FAILED rows return a 409 so the FE
// can disable the button without ambiguity.
//
// We stream via Node's `createReadStream` → ReadableStream so a 1 GB pg_dump
// doesn't get buffered into memory. Mime type is application/gzip for both
// kinds (pg_dump → .sql.gz, tar -czf → .tar.gz).
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by backend (R33 D-5).

import { NextResponse } from 'next/server';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok as _ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// `_ok` is intentionally unused here — download responses bypass the JSON
// envelope (they're a binary stream). Re-exporting keeps the import list
// stable across endpoints in this directory.
void _ok;

const BACKUP_ROOT = path.resolve(process.env.BACKUP_ROOT ?? './.data/backups');

/**
 * Validate that `storagePath` lives under BACKUP_ROOT. Defends against the
 * (unlikely) case of a row holding `..`-laden paths. Returns the absolute
 * path on success or null when the path escapes.
 */
function resolveSafe(storagePath: string): string | null {
  const abs = path.isAbsolute(storagePath)
    ? path.resolve(storagePath)
    : path.resolve(BACKUP_ROOT, storagePath);
  const root = BACKUP_ROOT.endsWith(path.sep) ? BACKUP_ROOT : BACKUP_ROOT + path.sep;
  if (!abs.startsWith(root) && abs !== BACKUP_ROOT) return null;
  return abs;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse | Response> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
    return error(ErrorCode.E_FORBIDDEN);
  }

  const row = await prisma.backup.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      kind: true,
      status: true,
      storagePath: true,
      sizeBytes: true,
      startedAt: true,
    },
  });
  if (!row) return error(ErrorCode.E_NOT_FOUND);

  if (row.status !== 'DONE') {
    return error(
      ErrorCode.E_STATE_CONFLICT,
      'DONE 상태의 백업만 다운로드할 수 있습니다.',
    );
  }
  if (!row.storagePath) {
    return error(ErrorCode.E_NOT_FOUND, '백업 파일 경로가 비어 있습니다.');
  }

  const abs = resolveSafe(row.storagePath);
  if (!abs) {
    return error(
      ErrorCode.E_VALIDATION,
      '백업 경로가 BACKUP_ROOT 외부입니다.',
    );
  }

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return error(
      ErrorCode.E_NOT_FOUND,
      '백업 파일이 존재하지 않습니다 (디스크에서 삭제된 것 같습니다).',
    );
  }
  if (!stat.isFile()) {
    return error(ErrorCode.E_VALIDATION, '백업 경로가 파일이 아닙니다.');
  }

  // Audit: admin pulled a backup. Don't await — logActivity already swallows
  // its own errors, but we keep the wait so failed audits aren't dropped on
  // the floor by the early return.
  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'BACKUP_DOWNLOAD',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      backupId: row.id,
      kind: row.kind,
      filename: path.basename(abs),
    },
  });

  const filename = path.basename(abs);
  const stream = Readable.toWeb(createReadStream(abs)) as NodeReadableStream<Uint8Array>;

  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      // Both POSTGRES (pg_dump | gzip) and FILES (tar -czf) artifacts are
      // gzip-compressed. The on-disk extension carries the precise format
      // (.sql.gz vs .tar.gz) and lands in Content-Disposition.
      'Content-Type': 'application/gzip',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
