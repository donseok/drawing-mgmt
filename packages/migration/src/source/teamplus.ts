// Real TeamPlus adapter — STUB.
//
// The TeamPlus DB schema hand-off from ops is pending (WBS 0.3). Until that
// arrives, this file documents the contract the real adapter has to fulfil
// and throws "not implemented" for every iterator. The pipeline + CLI work
// against the `MockSource` in the meantime.
//
// When the schema lands, the work is:
//   1. Pick a driver (`pg` for Postgres, `mssql`, `oracledb`, ...). Add the
//      dep to packages/migration/package.json + pnpm-lock.
//   2. Implement each `iterate*` as a streaming cursor query (`pg-query-stream`
//      or equivalent) so the in-process memory stays bounded.
//   3. Implement `resolveFile` by joining `MIGRATION_SOURCE_FILES_ROOT` with
//      the `sourcePath` returned from the row. Read with `fs/promises.readFile`,
//      compute SHA-256, return the buffer + hash.
//   4. Map the source columns into the `TeamPlus*` row shapes in
//      `source/types.ts`. Keep the *external* id columns intact — the
//      transform layer needs them for FK relinking.
//   5. Add an integration test under `__tests__/integration/` that points at
//      a sandbox TeamPlus copy.
//
// Until then, importing this module is fine but instantiating the adapter
// throws — `cli.ts` deliberately picks `MockSource` until env vars are set.

import type {
  Source,
  SourceFile,
  TeamPlusAttachment,
  TeamPlusDrawing,
  TeamPlusFolder,
  TeamPlusOrganization,
  TeamPlusRevision,
  TeamPlusUser,
  TeamPlusVersion,
} from './types.js';

export interface TeamPlusSourceConfig {
  /** Source DB connection string from MIGRATION_SOURCE_DB_URL. */
  dbUrl: string;
  /** Root directory on the NAS share, MIGRATION_SOURCE_FILES_ROOT. */
  filesRoot: string;
}

export class TeamPlusSource implements Source {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly _config: TeamPlusSourceConfig) {
    throw new Error(
      'TeamPlusSource is not implemented — TeamPlus DB schema hand-off ' +
        'pending (WBS 0.3). Use MockSource for dry-runs or wait for the ' +
        'real schema before extending this adapter.',
    );
  }

  countUsers(): Promise<number> {
    throw new Error('TeamPlusSource: not implemented');
  }
  countOrganizations(): Promise<number> {
    throw new Error('TeamPlusSource: not implemented');
  }
  countFolders(): Promise<number> {
    throw new Error('TeamPlusSource: not implemented');
  }
  countDrawings(): Promise<number> {
    throw new Error('TeamPlusSource: not implemented');
  }
  countAttachments(): Promise<number> {
    throw new Error('TeamPlusSource: not implemented');
  }

  async *iterateUsers(): AsyncIterable<TeamPlusUser> {
    throw new Error('TeamPlusSource: not implemented');
    // eslint-disable-next-line no-unreachable
    yield* [];
  }
  async *iterateOrganizations(): AsyncIterable<TeamPlusOrganization> {
    throw new Error('TeamPlusSource: not implemented');
    // eslint-disable-next-line no-unreachable
    yield* [];
  }
  async *iterateFolders(): AsyncIterable<TeamPlusFolder> {
    throw new Error('TeamPlusSource: not implemented');
    // eslint-disable-next-line no-unreachable
    yield* [];
  }
  async *iterateDrawings(): AsyncIterable<TeamPlusDrawing> {
    throw new Error('TeamPlusSource: not implemented');
    // eslint-disable-next-line no-unreachable
    yield* [];
  }
  async *iterateRevisions(): AsyncIterable<TeamPlusRevision> {
    throw new Error('TeamPlusSource: not implemented');
    // eslint-disable-next-line no-unreachable
    yield* [];
  }
  async *iterateVersions(): AsyncIterable<TeamPlusVersion> {
    throw new Error('TeamPlusSource: not implemented');
    // eslint-disable-next-line no-unreachable
    yield* [];
  }
  async *iterateAttachments(): AsyncIterable<TeamPlusAttachment> {
    throw new Error('TeamPlusSource: not implemented');
    // eslint-disable-next-line no-unreachable
    yield* [];
  }

  resolveFile(_path: string): Promise<SourceFile | null> {
    throw new Error('TeamPlusSource: not implemented');
  }
}
