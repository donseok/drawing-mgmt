// POST /api/v1/admin/security/audit/snapshot — R-AUDIT-TREND.
//
// Manually trigger a fresh `pnpm audit` snapshot. The work is delegated to
// the BullMQ `security-audit` queue + worker; this route returns 200 as
// soon as the job is enqueued (the audit subprocess takes 5-30s).
//
// Authorization: SUPER_ADMIN ONLY. Manual snapshots cost a subprocess +
// a DB row and bypass the daily cron's IO cushion, so we restrict them
// to the highest privilege tier. The legacy admin GET /audit endpoint
// (in-memory cache refresh) remains available to ADMIN.
//
// Response:
//   200 { data: { queued: true, jobId: '...' } }
//
// Failure modes:
//   - Redis unavailable / queue add failed → 503 + E_INTERNAL
//   - Auth missing → 401
//   - Non-SUPER_ADMIN → 403
//
// The worker tags the resulting SecurityAuditSnapshot row with
// `source='manual'` so trend queries filtering by source='cron' don't
// pick the snapshot up as noise.

import type { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { enqueueManualAuditSnapshot } from '@/lib/security-audit-queue';

export const POST = withApi(
  { rateLimit: 'api' },
  async (): Promise<NextResponse> => {
    let user;
    try {
      user = await requireUser();
    } catch (err) {
      if (err instanceof Response) return err as NextResponse;
      throw err;
    }

    // Stricter than GET /audit (which allows ADMIN). A manual snapshot
    // forks a pnpm subprocess + writes a DB row — we restrict to
    // SUPER_ADMIN to keep the operational cost bounded.
    if (user.role !== 'SUPER_ADMIN') {
      return error(ErrorCode.E_FORBIDDEN);
    }

    const result = await enqueueManualAuditSnapshot();
    if (!result.ok) {
      return error(
        ErrorCode.E_INTERNAL,
        '의존성 감사 스냅샷 작업을 큐에 넣지 못했습니다.',
        503,
        { code: 'AUDIT_ENQUEUE_FAILED', reason: result.error },
      );
    }

    return ok({
      queued: true,
      jobId: result.jobId!,
    });
  },
);
