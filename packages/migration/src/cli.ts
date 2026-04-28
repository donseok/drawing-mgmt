#!/usr/bin/env tsx
// Migration CLI — picks a source adapter, builds a pipeline, runs the
// requested command, persists the report, and prints a summary.
//
// Usage:
//   pnpm -F @drawing-mgmt/migration dry-run [--sample 50]
//   pnpm -F @drawing-mgmt/migration full    [--batch 100] [--resume]
//   pnpm -F @drawing-mgmt/migration verify  [--sample 50]
//   pnpm -F @drawing-mgmt/migration rehearsal      # = dry-run + verify
//
// Environment (see .env.example):
//   MIGRATION_SOURCE_DB_URL     TeamPlus DB URL — when set, we'd use the
//                               TeamPlusSource adapter (currently throws,
//                               see source/teamplus.ts TODO). Unset =
//                               MockSource for development / CI.
//   MIGRATION_SOURCE_FILES_ROOT TeamPlus NAS path (passed to TeamPlusSource).
//   MIGRATION_TARGET_DB_URL     Target DB URL for `full` mode. Defaults
//                               to DATABASE_URL.
//   MIGRATION_REPORT_DIR        Where JSON reports go. Default
//                               ./migration-reports relative to cwd.
//   MIGRATION_DRY_RUN=1         Force dry-run regardless of the command.
//                               Used by CI to keep accidental live runs
//                               from writing to a real DB.
//   FILE_STORAGE_ROOT           Where attachment bodies are written
//                               during `full`. Default ./migration-storage.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MockConversionQueue,
  MockSource,
  Pipeline,
  type PipelineConfig,
  writeReport,
} from './index.js';

interface CliArgs {
  command: 'dry-run' | 'full' | 'verify' | 'rehearsal' | 'help';
  sample?: number;
  batch?: number;
  resume: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  // argv = [node, script, command, ...flags]
  const command = (argv[2] ?? 'help') as CliArgs['command'];
  let sample: number | undefined;
  let batch: number | undefined;
  let resume = false;
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sample') {
      i++;
      const value = argv[i];
      sample = value !== undefined ? Number(value) : undefined;
    } else if (a === '--batch') {
      i++;
      const value = argv[i];
      batch = value !== undefined ? Number(value) : undefined;
    } else if (a === '--resume') {
      resume = true;
    }
  }
  return { command, sample, batch, resume };
}

function helpText(): string {
  return `drawing-migration — TeamPlus → drawing-mgmt ETL

Usage:
  pnpm -F @drawing-mgmt/migration dry-run [--sample N]
      Run the pipeline against the (mock) source without writing to DB or
      disk. Produces a JSON report under MIGRATION_REPORT_DIR.

  pnpm -F @drawing-mgmt/migration verify [--sample N]
      Re-run the pipeline and compare the source rows against the
      loader's id mapping. Reports per-row matched/mismatched.

  pnpm -F @drawing-mgmt/migration full [--batch N] [--resume]
      Live run. Requires MIGRATION_TARGET_DB_URL and FILE_STORAGE_ROOT.
      Currently disabled — the schema needs externalId columns first
      (see TODO in src/target/prisma-loader.ts).

  pnpm -F @drawing-mgmt/migration rehearsal
      = dry-run + verify, written as a single combined report.

  pnpm -F @drawing-mgmt/migration help
      This message.

Environment: see packages/migration/README.md.`;
}

function pickSource(): MockSource {
  // For now we always pick MockSource — TeamPlusSource throws on construct
  // until ops hands over the real schema. The CLI is structured so that
  // when it's ready, this single function picks it up.
  if (process.env.MIGRATION_SOURCE_DB_URL) {
    console.warn(
      '[migration] MIGRATION_SOURCE_DB_URL set, but TeamPlusSource is not yet ' +
        'implemented (see source/teamplus.ts). Falling back to MockSource.',
    );
  }
  return MockSource.create();
}

function reportDir(): string {
  return process.env.MIGRATION_REPORT_DIR ?? path.resolve('./migration-reports');
}

function storageRoot(): string {
  return process.env.FILE_STORAGE_ROOT ?? path.resolve('./migration-storage');
}

function buildConfig(opts: { dryRun: boolean }): PipelineConfig {
  const conversionQueue = new MockConversionQueue();
  return {
    source: pickSource(),
    loader: { dryRun: opts.dryRun },
    conversionQueue,
    storageRoot: storageRoot(),
    onProgress: (e) => {
      if (e.current !== undefined && e.total !== undefined) {
        process.stdout.write(
          `\r[migration] ${e.phase} ${e.current}/${e.total}     `,
        );
      } else if (e.message) {
        console.log(`[migration] ${e.phase}: ${e.message}`);
      }
      if (e.phase === 'done') process.stdout.write('\n');
    },
  };
}

async function runDryRun(args: CliArgs): Promise<number> {
  const cfg = buildConfig({ dryRun: true });
  const pipeline = new Pipeline(cfg);
  const report = await pipeline.dryRun({ sample: args.sample });
  const file = await writeReport(report, reportDir(), 'migration');
  console.log(JSON.stringify(summarize(report), null, 2));
  console.log(`[migration] report → ${file}`);
  return report.rowErrors.length === 0 ? 0 : 1;
}

async function runVerify(args: CliArgs): Promise<number> {
  const cfg = buildConfig({ dryRun: true });
  const pipeline = new Pipeline(cfg);
  const report = await pipeline.verify({ sampleSize: args.sample ?? 50 });
  const file = await writeReport(report, reportDir(), 'verify');
  console.log(JSON.stringify(report, null, 2));
  console.log(`[migration] report → ${file}`);
  return report.mismatched === 0 ? 0 : 1;
}

async function runFull(args: CliArgs): Promise<number> {
  if (process.env.MIGRATION_DRY_RUN === '1') {
    console.warn(
      '[migration] MIGRATION_DRY_RUN=1 — coercing `full` to dry-run',
    );
    return runDryRun(args);
  }
  console.error(
    '[migration] `full` command is not yet enabled. The target schema ' +
      'needs externalId columns first — see TODO in ' +
      'src/target/prisma-loader.ts. Use `dry-run` for now.',
  );
  return 2;
}

async function runRehearsal(args: CliArgs): Promise<number> {
  console.log('[migration] === rehearsal: dry-run ===');
  const dr = await runDryRun(args);
  console.log('[migration] === rehearsal: verify ===');
  const ve = await runVerify(args);
  return dr === 0 && ve === 0 ? 0 : 1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarize(report: any): Record<string, unknown> {
  return {
    mode: report.mode,
    durationMs: report.durationMs,
    source: report.source,
    counters: report.load.counters,
    checksumMismatches: report.load.checksumMismatches.length,
    missingFiles: report.load.missingFiles.length,
    numberCollisions: report.numberCollisions.length,
    folderCodeCollisions: report.folderCodeCollisions.length,
    conversionEnqueued: report.conversionEnqueued,
    rowErrors: report.rowErrors.length,
  };
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const args = parseArgs(argv);
  switch (args.command) {
    case 'dry-run':
      return runDryRun(args);
    case 'verify':
      return runVerify(args);
    case 'full':
      return runFull(args);
    case 'rehearsal':
      return runRehearsal(args);
    case 'help':
    default:
      console.log(helpText());
      return args.command === 'help' ? 0 : 1;
  }
}

// Run when invoked directly (handles `tsx src/cli.ts`, `node dist/cli.js`,
// and `pnpm -F @drawing-mgmt/migration dry-run`).
const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

// Re-export for tests that want to drive `main()` directly.
export { parseArgs, fileURLToPath };
