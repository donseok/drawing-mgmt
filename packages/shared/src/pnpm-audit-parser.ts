// R-AUDIT-TREND — pnpm audit output parser (extracted from
// `apps/web/app/api/v1/admin/security/audit/route.ts`).
//
// Both the legacy admin GET/POST route AND the daily snapshot worker
// (`apps/worker/src/security-audit-worker.ts`) need to parse `pnpm audit
// --json` stdout. This module is the canonical home: pure / dep-free /
// shared between web + worker via `@drawing-mgmt/shared/pnpm-audit-parser`.
//
// pnpm's `--json` output across versions either:
//   1) emits a single JSON object with `advisories: { id: {...} }` plus a
//      `metadata.vulnerabilities` summary (npm/pnpm 8 shape), OR
//   2) emits a stream of JSON Lines, one advisory per line (newer pnpm).
//
// We try the single-object form first (fast path) and fall back to JSONL
// when that fails. Both shapes are normalized into the same
// `{ counts, advisories }` tuple. The counts are derived from the advisory
// list when we have one (more accurate) and from the metadata summary as
// a fallback. When we have *both* and they disagree, we take the max so
// the header counts never under-report relative to what pnpm declared.
//
// IMPORTANT — keep this module zero-dep + pure. The worker imports it and
// must not pull a Next.js runtime into its bundle.

export interface VulnerabilityCounts {
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

/**
 * Single advisory entry surfaced to the admin VulnerabilitiesTable + the
 * snapshot's `advisoriesJson` column. Strict subset of fields pnpm exposes
 * across both output shapes — denormalized so the FE renders directly
 * without a second hop.
 */
export interface AdvisoryEntry {
  id: string | number;
  severity: 'critical' | 'high' | 'moderate' | 'low';
  title: string;
  package: string;
  versionRange: string | null;
  url: string | null;
}

/**
 * Raw advisory shape we tolerate from either pnpm output mode. Every
 * field is optional — `mapAdvisory` enforces the minimum (severity).
 */
export interface RawAdvisory {
  id?: string | number;
  severity?: string;
  title?: string;
  module_name?: string;
  // pnpm 9 sometimes uses `name` instead of `module_name`.
  name?: string;
  vulnerable_versions?: string;
  // pnpm 9 sometimes uses `range` instead of `vulnerable_versions`.
  range?: string;
  url?: string;
  // pnpm 9 sometimes nests advisory metadata under `advisory`.
  advisory?: {
    title?: string;
    module_name?: string;
    name?: string;
    vulnerable_versions?: string;
    range?: string;
    url?: string;
    severity?: string;
  };
}

export function zeroCounts(): VulnerabilityCounts {
  return { critical: 0, high: 0, moderate: 0, low: 0 };
}

/**
 * Map any of pnpm's severity strings ('critical' / 'high' / 'moderate' /
 * 'medium' / 'low' / 'info') into the canonical four-bucket scheme used
 * by the FE table + the snapshot row. Returns `null` for unrecognized
 * values so they're dropped (rather than mis-bucketed).
 */
export function canonicalSeverity(
  s: string,
): 'critical' | 'high' | 'moderate' | 'low' | null {
  switch (s) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'moderate':
    case 'medium':
      return 'moderate';
    case 'low':
    case 'info':
      return 'low';
    default:
      return null;
  }
}

/**
 * Normalize a raw advisory record into the canonical `AdvisoryEntry`.
 * Returns `null` when the record is missing essential fields (severity)
 * — those are dropped from the table but counted via the metadata
 * summary if available.
 */
export function mapAdvisory(
  id: string | number,
  raw: RawAdvisory,
): AdvisoryEntry | null {
  const a = raw.advisory ?? {};
  const sevRaw = (raw.severity ?? a.severity ?? '').toLowerCase();
  const severity = canonicalSeverity(sevRaw);
  if (!severity) return null;
  const pkg =
    raw.module_name ?? raw.name ?? a.module_name ?? a.name ?? '(unknown)';
  const title = raw.title ?? a.title ?? '(no title)';
  const versionRange =
    raw.vulnerable_versions ??
    raw.range ??
    a.vulnerable_versions ??
    a.range ??
    null;
  const url = raw.url ?? a.url ?? null;
  return {
    id,
    severity,
    title,
    package: pkg,
    versionRange,
    url,
  };
}

/**
 * Tolerant parser. See module-level header for the two output shapes.
 * Returns `{ counts, advisories }`. Advisories may be empty even when
 * counts > 0 (older pnpm: metadata summary only, no per-advisory detail).
 */
export function parseAuditDetail(
  stdout: string,
): { counts: VulnerabilityCounts; advisories: AdvisoryEntry[] } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { counts: zeroCounts(), advisories: [] };
  }

  // 1) Single JSON blob (npm/pnpm 8 shape).
  try {
    const parsed = JSON.parse(trimmed) as {
      metadata?: {
        vulnerabilities?: Partial<VulnerabilityCounts> & {
          info?: number;
        };
      };
      advisories?: Record<string, RawAdvisory>;
    };

    // 1a) advisories map present — preferred path, gives us per-row detail.
    if (parsed.advisories && typeof parsed.advisories === 'object') {
      const advisories: AdvisoryEntry[] = [];
      const counts = zeroCounts();
      for (const [id, raw] of Object.entries(parsed.advisories)) {
        const entry = mapAdvisory(id, raw);
        if (!entry) continue;
        advisories.push(entry);
        counts[entry.severity]++;
      }
      // If the metadata summary has higher counts than what we mapped (e.g.
      // a malformed advisory we dropped), prefer the metadata for the
      // header badges so we don't under-report.
      if (parsed.metadata?.vulnerabilities) {
        const v = parsed.metadata.vulnerabilities;
        return {
          counts: {
            critical: Math.max(counts.critical, v.critical ?? 0),
            high: Math.max(counts.high, v.high ?? 0),
            moderate: Math.max(counts.moderate, v.moderate ?? 0),
            low: Math.max(counts.low, v.low ?? 0),
          },
          advisories,
        };
      }
      return { counts, advisories };
    }

    // 1b) metadata summary only — no advisory detail available.
    if (parsed.metadata?.vulnerabilities) {
      const v = parsed.metadata.vulnerabilities;
      return {
        counts: {
          critical: v.critical ?? 0,
          high: v.high ?? 0,
          moderate: v.moderate ?? 0,
          low: v.low ?? 0,
        },
        advisories: [],
      };
    }
  } catch {
    // fall through to JSONL parsing
  }

  // 2) JSON-Lines stream (newer pnpm). Each non-empty line is its own
  //    advisory record. We map each line into AdvisoryEntry and increment
  //    the severity counter.
  const counts = zeroCounts();
  const advisories: AdvisoryEntry[] = [];
  for (const raw of trimmed.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as RawAdvisory & { id?: string | number };
      const entry = mapAdvisory(
        obj.id !== undefined ? String(obj.id) : `idx-${advisories.length}`,
        obj,
      );
      if (entry) {
        advisories.push(entry);
        counts[entry.severity]++;
      }
    } catch {
      // skip malformed lines — pnpm sometimes interleaves a banner.
    }
  }
  return { counts, advisories };
}

/** Sum a `VulnerabilityCounts` into a single integer (used for `total`). */
export function sumCounts(c: VulnerabilityCounts): number {
  return c.critical + c.high + c.moderate + c.low;
}
