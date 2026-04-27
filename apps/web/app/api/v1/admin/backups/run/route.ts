// POST /api/v1/admin/backups/run
//
// R33 / D-5 — admin "지금 실행" trigger. Creates a Backup row (RUNNING) and
// pushes a job onto the BullMQ `backup` queue. The worker (apps/worker)
// runs pg_dump or tars FILE_STORAGE_ROOT and updates the row to
// DONE/FAILED.
//
// Body: { kind: 'POSTGRES' | 'FILES' }.
//
// Returns the new row's id + initial status so the FE can start polling
// /api/v1/admin/backups for completion.
//
// Authorization: SUPER_ADMIN or ADMIN.
//
// Owned by backend (R33 D-5).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BackupKind } from '@prisma/client';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';
import { enqueueBackup } from '@/lib/backup-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  kind: z.nativeEnum(BackupKind),
});

export const POST = withApi({ rateLimit: 'api' }, async (req) => {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }

  const result = await enqueueBackup(parsed.data.kind);
  if (!result.ok) {
    return error(ErrorCode.E_INTERNAL, '백업 큐 등록 실패: ' + result.error);
  }

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'BACKUP_RUN',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { jobId: result.jobId, kind: parsed.data.kind },
  });

  return ok({ jobId: result.jobId, status: 'RUNNING' as const });
});
