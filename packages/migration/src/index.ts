// Public API surface for `@drawing-mgmt/migration`.
//
// Importable from a sibling package or from the CLI. The CLI re-uses these
// exports so there's exactly one source of truth for the public types.

export { Pipeline } from './pipeline.js';
export type {
  DryRunOptions,
  FullRunOptions,
  PipelineConfig,
  ProgressEvent,
  VerifyOptions,
} from './pipeline.js';

export { verifyMigration } from './verify.js';

export {
  Loader,
  type LoaderOptions,
  type LoadResult,
  type PrismaLike,
} from './target/prisma-loader.js';

export type {
  ConversionEnqueueRequest,
  ConversionQueueAdapter,
} from './target/conversion-queue.js';
export { MockConversionQueue } from './target/conversion-queue.js';

export { MockSource, type MockSourceOptions } from './source/mock.js';
export { TeamPlusSource, type TeamPlusSourceConfig } from './source/teamplus.js';

export type {
  Source,
  SourceFile,
  TeamPlusAttachment,
  TeamPlusDrawing,
  TeamPlusFolder,
  TeamPlusOrganization,
  TeamPlusRevision,
  TeamPlusUser,
  TeamPlusVersion,
} from './source/types.js';

export type {
  TargetAttachment,
  TargetFolder,
  TargetObject,
  TargetOrganization,
  TargetRevision,
  TargetUser,
  TargetVersion,
} from './target/types.js';

export type {
  MigrationReport,
  VerificationReport,
  VerificationSampleResult,
} from './report.js';
export { writeReport } from './report.js';

export {
  mapEmploymentType,
  mapObjectState,
  mapRole,
  normalizeFolderCode,
  clampSecurityLevel,
} from './transform/helpers.js';
