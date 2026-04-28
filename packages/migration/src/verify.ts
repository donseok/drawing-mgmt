// Standalone verification helper.
//
// `Pipeline.verify()` is the canonical entry point used by the CLI; this
// module just re-exports it as a named function for readability + future
// growth (e.g. a CSV-style audit report alongside the JSON one). Keeping
// it as a thin shim today avoids divergent implementations between
// `pipeline.verify(...)` and `verifyMigration(...)`.

import { Pipeline } from './pipeline.js';
import type { PipelineConfig, VerifyOptions } from './pipeline.js';
import type { VerificationReport } from './report.js';

export async function verifyMigration(
  config: PipelineConfig,
  opts: VerifyOptions,
): Promise<VerificationReport> {
  const pipeline = new Pipeline(config);
  return pipeline.verify(opts);
}

export type { VerificationReport, VerifyOptions };
