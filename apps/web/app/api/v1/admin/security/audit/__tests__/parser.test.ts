// R-AUDIT-TREND — Parser unit tests for the extracted pnpm audit helper.
//
// `parseAuditDetail` was extracted from
// `apps/web/app/api/v1/admin/security/audit/route.ts` to
// `packages/shared/src/pnpm-audit-parser.ts` so the daily snapshot
// worker (apps/worker/src/security-audit-worker.ts) can reuse it. These
// tests pin all four input shapes the route used to handle in-line so
// the extraction is provably zero-behavior-change:
//
//   1. Single JSON object with `advisories` map (npm/pnpm 8 shape).
//   2. JSON-Lines stream, one advisory per line (newer pnpm).
//   3. Single JSON object with `metadata.vulnerabilities` summary only
//      (no per-advisory detail).
//   4. Empty stdout (audit ran but had no output).
//
// We exercise the canonical severity bucketing + the metadata-vs-mapped
// `Math.max` reconciliation in case 1, the malformed-line tolerance in
// case 2, and the zero-counts default in case 4.

import { describe, it, expect } from 'vitest';
import {
  parseAuditDetail,
  canonicalSeverity,
  zeroCounts,
} from '@drawing-mgmt/shared/pnpm-audit-parser';

describe('parseAuditDetail', () => {
  it('parses a single JSON blob with an advisories map (case 1)', () => {
    // pnpm/npm 8 shape: top-level `advisories: { id: {...} }` plus a
    // `metadata.vulnerabilities` summary. We expect both severity
    // bucketing AND the `Math.max(metadata, mapped)` reconciliation to
    // kick in so under-counted advisories don't slip past the header.
    const stdout = JSON.stringify({
      advisories: {
        '1234': {
          id: 1234,
          severity: 'high',
          title: 'Prototype pollution',
          module_name: 'lodash',
          vulnerable_versions: '<4.17.21',
          url: 'https://github.com/advisories/GHSA-...',
        },
        '5678': {
          id: 5678,
          severity: 'moderate',
          title: 'Regex DoS',
          module_name: 'minimist',
          vulnerable_versions: '<1.2.6',
          url: null,
        },
        // A malformed advisory (no severity) — should be dropped from
        // the list but counted via metadata fallback.
        '9999': {
          id: 9999,
          title: '???',
        },
      },
      metadata: {
        // Metadata claims an extra moderate (the 9999 row above).
        vulnerabilities: { critical: 0, high: 1, moderate: 2, low: 0 },
      },
    });

    const out = parseAuditDetail(stdout);

    expect(out.counts).toEqual({
      critical: 0,
      high: 1,
      moderate: 2, // metadata wins over mapped (1) → 2
      low: 0,
    });
    expect(out.advisories).toHaveLength(2);
    expect(out.advisories.map((a) => a.severity).sort()).toEqual([
      'high',
      'moderate',
    ]);
    const high = out.advisories.find((a) => a.severity === 'high')!;
    expect(high.package).toBe('lodash');
    expect(high.versionRange).toBe('<4.17.21');
    expect(high.url).toBe('https://github.com/advisories/GHSA-...');
  });

  it('parses a JSON-Lines stream (case 2)', () => {
    // Newer pnpm — one advisory record per line. Includes a banner
    // line + a malformed line to exercise the `try/catch` skip path.
    const lines = [
      'pnpm audit details (banner — should be skipped):',
      JSON.stringify({
        id: 'GHSA-abc1',
        severity: 'critical',
        title: 'Arbitrary code execution',
        name: 'serialize-javascript',
        range: '<3.1.0',
      }),
      '',
      JSON.stringify({
        id: 'GHSA-def2',
        severity: 'low',
        title: 'Open redirect',
        name: 'next',
      }),
      JSON.stringify({
        id: 'GHSA-ghi3',
        // pnpm 9 sometimes nests under `advisory`.
        advisory: {
          severity: 'medium',
          title: 'Slow regex',
          name: 'micromatch',
          vulnerable_versions: '<4.0.8',
        },
      }),
      '{ this is not valid JSON',
    ].join('\n');

    const out = parseAuditDetail(lines);

    expect(out.counts).toEqual({
      critical: 1,
      high: 0,
      moderate: 1, // 'medium' canonicalizes to 'moderate'
      low: 1,
    });
    expect(out.advisories).toHaveLength(3);
    const ids = out.advisories.map((a) => String(a.id)).sort();
    expect(ids).toEqual(['GHSA-abc1', 'GHSA-def2', 'GHSA-ghi3']);
    const moderate = out.advisories.find((a) => a.severity === 'moderate')!;
    expect(moderate.package).toBe('micromatch');
    expect(moderate.versionRange).toBe('<4.0.8');
  });

  it('parses metadata-only output (case 3)', () => {
    // Older pnpm sometimes emits only the rollup summary. We must
    // extract counts from it and return an empty advisory list.
    const stdout = JSON.stringify({
      metadata: {
        vulnerabilities: { critical: 2, high: 5, moderate: 3, low: 0, info: 1 },
      },
    });

    const out = parseAuditDetail(stdout);

    expect(out.counts).toEqual({
      critical: 2,
      high: 5,
      moderate: 3,
      low: 0,
    });
    expect(out.advisories).toEqual([]);
  });

  it('handles empty stdout (case 4)', () => {
    // pnpm audit can succeed with no output (e.g. no lockfile changes
    // since last cache, certain offline modes). The helper must return
    // zero counts + empty list rather than throw.
    expect(parseAuditDetail('')).toEqual({
      counts: zeroCounts(),
      advisories: [],
    });
    expect(parseAuditDetail('   \n  \n')).toEqual({
      counts: zeroCounts(),
      advisories: [],
    });
  });

  it('canonicalSeverity maps medium→moderate and info→low', () => {
    // Pinned because the route used to depend on this exact bucketing
    // — a future regression that drops 'info' or mis-buckets 'medium'
    // would silently change the trend chart.
    expect(canonicalSeverity('critical')).toBe('critical');
    expect(canonicalSeverity('high')).toBe('high');
    expect(canonicalSeverity('moderate')).toBe('moderate');
    expect(canonicalSeverity('medium')).toBe('moderate');
    expect(canonicalSeverity('low')).toBe('low');
    expect(canonicalSeverity('info')).toBe('low');
    expect(canonicalSeverity('unknown')).toBeNull();
    expect(canonicalSeverity('')).toBeNull();
  });
});
