// Migration / verification reports.
//
// Two shapes:
//   - `MigrationReport` — produced by `pipeline.dryRun()` and
//     `pipeline.full()`. Captures counters, errors, collisions, queue
//     enqueue counts, and the run timestamp.
//   - `VerificationReport` — produced by `pipeline.verify()`. For each of
//     the N sampled drawings, records whether the source / target rows
//     match on every interesting field, plus the on-disk file checksum.
//
// Both are JSON-serialisable on purpose; the CLI writes them to
// `${MIGRATION_REPORT_DIR}/migration-${ts}.json` and
// `${MIGRATION_REPORT_DIR}/verify-${ts}.json` for the audit trail.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { LoadResult } from './target/prisma-loader.js';

export interface MigrationReport {
  mode: 'dry-run' | 'full';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  source: {
    users: number;
    organizations: number;
    folders: number;
    drawings: number;
    attachments: number;
  };
  load: LoadResult;
  /** Drawing numbers that collided during transform. */
  numberCollisions: string[];
  /** Folder codes that collided during transform. */
  folderCodeCollisions: string[];
  conversionEnqueued: number;
  /** Top-level errors that aborted a row but didn't kill the run. */
  rowErrors: Array<{ entity: string; externalId: string; reason: string }>;
}

export interface VerificationSampleResult {
  externalId: string;
  number: string;
  ok: boolean;
  /** Field-by-field mismatch list. Empty when ok=true. */
  mismatches: string[];
}

export interface VerificationReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sampleSize: number;
  matched: number;
  mismatched: number;
  results: VerificationSampleResult[];
}

/**
 * Persist a JSON report to `${reportDir}/${prefix}-${timestamp}.json`.
 * Returns the absolute path written.
 */
export async function writeReport(
  report: MigrationReport | VerificationReport,
  reportDir: string,
  prefix: 'migration' | 'verify',
): Promise<string> {
  await fs.mkdir(reportDir, { recursive: true });
  const ts = report.startedAt.replace(/[:.]/g, '-');
  const file = path.join(reportDir, `${prefix}-${ts}.json`);
  await fs.writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}
