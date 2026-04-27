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

interface VulnerabilityCounts {
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

interface AuditPayload {
  vulnerabilities: VulnerabilityCounts;
  count: number;
  lastChecked: string;
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
        const counts = parseAuditOutput(stdout);
        finish(() =>
          resolve({
            vulnerabilities: counts,
            count:
              counts.critical + counts.high + counts.moderate + counts.low,
            lastChecked: new Date().toISOString(),
          }),
        );
      } catch (err) {
        finish(() => reject(err));
      }
    });
  });
}

/**
 * Tolerant parser. pnpm's `--json` output across versions either emits a
 * single JSON object with a `metadata.vulnerabilities` summary, or a
 * stream of JSON Lines where each line is one advisory. Try the single-
 * object form first and fall back to JSONL.
 */
function parseAuditOutput(stdout: string): VulnerabilityCounts {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return zeroCounts();
  }

  // 1) Single JSON blob (npm/pnpm 8 shape).
  try {
    const parsed = JSON.parse(trimmed) as {
      metadata?: {
        vulnerabilities?: Partial<VulnerabilityCounts> & {
          info?: number;
        };
      };
      advisories?: Record<
        string,
        { severity?: string }
      >;
    };
    if (parsed.metadata?.vulnerabilities) {
      const v = parsed.metadata.vulnerabilities;
      return {
        critical: v.critical ?? 0,
        high: v.high ?? 0,
        moderate: v.moderate ?? 0,
        low: v.low ?? 0,
      };
    }
    // Some pnpm versions emit just the advisories map.
    if (parsed.advisories) {
      const counts = zeroCounts();
      for (const id of Object.keys(parsed.advisories)) {
        const s = parsed.advisories[id]?.severity ?? 'low';
        bumpSeverity(counts, s);
      }
      return counts;
    }
  } catch {
    // fall through to JSONL parsing
  }

  // 2) JSON-Lines stream (newer pnpm). Each non-empty line is its own JSON.
  const counts = zeroCounts();
  for (const raw of trimmed.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as { severity?: string };
      if (obj && typeof obj.severity === 'string') {
        bumpSeverity(counts, obj.severity);
      }
    } catch {
      // skip malformed lines — pnpm sometimes interleaves a banner.
    }
  }
  return counts;
}

function zeroCounts(): VulnerabilityCounts {
  return { critical: 0, high: 0, moderate: 0, low: 0 };
}

function bumpSeverity(counts: VulnerabilityCounts, severity: string) {
  switch (severity.toLowerCase()) {
    case 'critical':
      counts.critical++;
      break;
    case 'high':
      counts.high++;
      break;
    case 'moderate':
    case 'medium':
      counts.moderate++;
      break;
    case 'low':
    case 'info':
      counts.low++;
      break;
  }
}

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
