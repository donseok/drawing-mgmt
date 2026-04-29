// GET /api/v1/admin/security/audit/trend — R-AUDIT-TREND.
//
// Returns the time-series of `SecurityAuditSnapshot` rows so the admin
// security page (and a future chart) can plot how the four severity
// counters have evolved. The legacy `audit/route.ts` keeps a 15-min
// in-memory snapshot of "current state"; this route is the long-running
// baseline that survives instance restarts (FIND-016 mitigation).
//
// Query params:
//   days   — 1..365, default 30. Window is `now - days .. now`.
//   source — 'cron' | 'manual' | omitted. Default 'cron' so the chart
//            doesn't pick up admin ad-hoc runs as noise. Pass nothing
//            (omit the key) to include both — useful for an audit log
//            view, not a trend chart.
//
// Response:
//   data: { days, source, snapshots: [...] }
// `snapshots` is `takenAt` ASC (chart-friendly). `advisoriesJson` is NOT
// returned here to keep the payload small even when source='cron' over
// a 365-day window with 100+ advisory rows — admins can hit the legacy
// `audit/route.ts` for the current detail. A future endpoint can return
// `advisoriesJson` for a single snapshot id if diff-style use cases need it.
//
// Authorization: SUPER_ADMIN or ADMIN. Owned by BE.

import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  // `optional()` distinguishes "explicitly absent" (= include all sources)
  // from a typed enum value. We don't default 'cron' here — the route
  // applies the default *after* parse so the response can echo the
  // effective source the user got, including the implicit one.
  source: z.enum(['cron', 'manual']).optional(),
});

export interface TrendSnapshot {
  id: string;
  takenAt: string;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  total: number;
  source: string;
  durationMs: number | null;
}

export interface TrendResponse {
  days: number;
  source: 'cron' | 'manual' | 'all';
  snapshots: TrendSnapshot[];
}

export const GET = withApi(
  { rateLimit: 'api' },
  async (req): Promise<NextResponse> => {
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

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      days: url.searchParams.get('days') ?? undefined,
      source: url.searchParams.get('source') ?? undefined,
    });
    if (!parsed.success) {
      return error(
        ErrorCode.E_VALIDATION,
        '쿼리 파라미터가 올바르지 않습니다.',
        400,
        { issues: parsed.error.issues },
      );
    }
    const { days, source } = parsed.data;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Default to source='cron' for the trend chart so an operator's
    // manual reruns don't show up as bumps. Explicitly passing
    // ?source=manual flips to manual-only; passing ?source= (empty)
    // falls through to "all" which we represent below.
    //
    // NOTE on "all": the URLSearchParams getter returns null for an
    // absent key vs. '' for an empty value. zod's preprocess treats
    // both as undefined, which means the only way to get "all" is to
    // pass `?source=all` — but the contract restricts to {'cron',
    // 'manual'}. We therefore expose the implicit cron default + a
    // typed manual override. If admins need "all" later we'll extend
    // the enum rather than overload the absent case.
    const effectiveSource: 'cron' | 'manual' = source ?? 'cron';

    const rows = await prisma.securityAuditSnapshot.findMany({
      where: {
        takenAt: { gte: since },
        source: effectiveSource,
      },
      orderBy: { takenAt: 'asc' },
      select: {
        id: true,
        takenAt: true,
        critical: true,
        high: true,
        moderate: true,
        low: true,
        total: true,
        source: true,
        durationMs: true,
      },
    });

    const snapshots: TrendSnapshot[] = rows.map((r) => ({
      id: r.id,
      takenAt: r.takenAt.toISOString(),
      critical: r.critical,
      high: r.high,
      moderate: r.moderate,
      low: r.low,
      total: r.total,
      source: r.source,
      durationMs: r.durationMs,
    }));

    const body: TrendResponse = {
      days,
      source: effectiveSource,
      snapshots,
    };
    return ok(body);
  },
);
