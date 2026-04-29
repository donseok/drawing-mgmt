// GET /api/v1/admin/security/audit — R40 / R39 finish.
//
// Surfaces the project's current `pnpm audit` posture to the admin security
// page. Spawns `pnpm audit --json` and parses the (line-delimited or single
// blob) JSON output into per-severity counts. Cached in-memory for 15 min
// so refresh storms don't fork a child process per render.
//
// We deliberately do NOT shell out to `npm audit` — pnpm's resolver knows
// our workspace structure and `--json` is the documented machine-readable
// stream. The shape varies across pnpm 8/9 minor releases; we tolerate
// either:
//   - { advisories: { <id>: { severity, ... }}, metadata: { vulnerabilities: { critical, high, ... }}}
//   - JSON-Lines stream of `{ id, severity, ... }` records (newer pnpm).
//
// Authorization: SUPER_ADMIN or ADMIN. Owned by BE.
//
// Response shape:
//   { vulnerabilities: { critical, high, moderate, low }, count, lastChecked }

import type { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
// R-AUDIT-TREND — the per-row parser + types live in `@drawing-mgmt/shared`
// so the daily snapshot worker (apps/worker/src/security-audit-worker.ts)
// imports the same code path. Behavior here is unchanged: this route still
// 15-min in-memory caches the parsed payload + falls back to stale on
// subprocess failure. Only the helper *location* moved.
import {
  parseAuditDetail,
  type AdvisoryEntry,
  type VulnerabilityCounts,
} from '@drawing-mgmt/shared/pnpm-audit-parser';

interface AuditPayload {
  vulnerabilities: VulnerabilityCounts;
  count: number;
  lastChecked: string;
  // R41 / B — per-advisory detail. May be empty even when `count > 0` if
  // pnpm only emitted a metadata summary; in that case the FE shows a
  // graceful "no detail available" empty state.
  advisories: AdvisoryEntry[];
}

// 15-min in-memory cache. The audit payload is a small JSON blob and
// auditing is read-mostly, so we don't bother with Redis here. Multiple
// Next.js Node instances will each maintain their own cache; that's
// acceptable — staleness is bounded by the TTL.
const CACHE_TTL_MS = 15 * 60 * 1000;
let cachedAt = 0;
let cached: AuditPayload | null = null;

// Hard cap — stop pnpm if it hangs (e.g. registry timeout). 60s is enough
// for our workspace; the FE shows a stale cache otherwise.
const AUDIT_TIMEOUT_MS = 60 * 1000;

export async function GET(): Promise<NextResponse> {
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

  // Cache hit?
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) {
    return ok(cached, { cached: true });
  }

  let payload: AuditPayload;
  try {
    payload = await runPnpmAudit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[admin.security.audit] pnpm audit failed', err);
    // Fall back to whatever stale value we have so the page can still
    // render *something*. If we have nothing, surface 503.
    if (cached) return ok(cached, { cached: true, stale: true });
    return error(
      ErrorCode.E_INTERNAL,
      '의존성 감사 명령 실행에 실패했습니다.',
      503,
      { code: 'AUDIT_RUN_FAILED' },
    );
  }

  cached = payload;
  cachedAt = Date.now();
  return ok(payload, { cached: false });
}

/**
 * Spawn `pnpm audit --json` in the repo root and parse the result. Resolves
 * with the totals; rejects if the process fails to start or exits with an
 * unrecognized non-zero code (pnpm exits 1 when vulnerabilities exist —
 * that is the expected happy-path-with-issues, NOT a failure).
 */
function runPnpmAudit(): Promise<AuditPayload> {
  return new Promise((resolve, reject) => {
    // Inherit cwd (Node will set it to the process cwd, which in dev/prod is
    // the monorepo root because Next.js boots there). Use shell-less spawn.
    const child = spawn('pnpm', ['audit', '--json'], {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | null = null;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => reject(new Error('pnpm audit timed out')));
    }, AUDIT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => {
      // pnpm audit exit codes:
      //   0 → no vulnerabilities found
      //   1 → vulnerabilities found (still a successful audit)
      //   anything else → real failure
      if (code !== 0 && code !== 1) {
        finish(() =>
          reject(
            new Error(
              `pnpm audit exited with code=${code}: ${stderr.slice(0, 500)}`,
            ),
          ),
        );
        return;
      }
      try {
        const detail = parseAuditDetail(stdout);
        finish(() =>
          resolve({
            vulnerabilities: detail.counts,
            count:
              detail.counts.critical +
              detail.counts.high +
              detail.counts.moderate +
              detail.counts.low,
            advisories: detail.advisories,
            lastChecked: new Date().toISOString(),
          }),
        );
      } catch (err) {
        finish(() => reject(err));
      }
    });
  });
}

// R-AUDIT-TREND — `parseAuditDetail` + supporting types now live in
// `@drawing-mgmt/shared/pnpm-audit-parser` (imported above). The route's
// behavior is unchanged; only the helper *location* moved so the daily
// snapshot worker can reuse the same logic. See module header for the
// two pnpm output shapes (single JSON blob vs. JSONL stream).

/**
 * Test seam — drop the cache so integration/test runs aren't poisoned by a
 * prior fixture's value. Not exported in the OpenAPI spec.
 */
export function _resetAuditCacheForTest(): void {
  cached = null;
  cachedAt = 0;
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/admin/security/audit — R40 §2.3.
//
// Admin-triggered cache invalidation + immediate re-run. The /admin/security
// page's [지금 검사] button hits this; the FE invalidates the GET query on
// the 200 response so the carded counts pick up the fresh result.
//
// Authorization is identical to GET (SUPER_ADMIN/ADMIN). We wrap with
// `withApi({ rateLimit: 'api' })` because this is a mutating endpoint —
// the rate-limit guard prevents an angry admin from forking dozens of
// pnpm subprocesses. CSRF is also enforced by `withApi` for non-GET.
//
// Behavior on subprocess failure: same fallback as GET — return whatever
// stale cached value exists, or 503 with `AUDIT_RUN_FAILED`. The cache
// invalidation step is the single difference from GET.
// ─────────────────────────────────────────────────────────────────────────

export const POST = withApi({ rateLimit: 'api' }, async () => {
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

  // Force a fresh run — drop the cache regardless of TTL.
  cached = null;
  cachedAt = 0;

  let payload: AuditPayload;
  try {
    payload = await runPnpmAudit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[admin.security.audit] forced re-run failed', err);
    // Same stale-fallback policy as GET.
    if (cached) return ok(cached, { cached: true, stale: true });
    return error(
      ErrorCode.E_INTERNAL,
      '의존성 감사 명령 실행에 실패했습니다.',
      503,
      { code: 'AUDIT_RUN_FAILED' },
    );
  }

  cached = payload;
  cachedAt = Date.now();
  return ok(payload, { cached: false });
});
