// Source-side abstraction for the TeamPlus → drawing-mgmt ETL.
//
// The real TeamPlus DB schema is going to be handed over by ops at a later
// date — until then everything in `source/teamplus.ts` is a stub and the
// `source/mock.ts` adapter is what the unit tests + CLI dry-runs hit. The
// pipeline only ever sees this `Source` interface, so swapping in the real
// adapter is a single-line change in `cli.ts`.
//
// Design notes:
//
// * Iterator pattern (`AsyncIterable`) so we can stream millions of rows
//   without loading them all into memory. The mock backs them with arrays
//   for simplicity but preserves the contract.
// * `count*` methods are required for progress reporting — we want to be
//   able to print "327 / 12,485 drawings transformed" without buffering
//   the whole result set first. The real adapter will run cheap COUNT(*)
//   queries.
// * `resolveFile` is separate from row iteration because the file body is
//   often on a NAS share that maps differently from the DB. The pipeline
//   calls it lazily once per attachment, getting back a buffer plus the
//   computed SHA-256 (the source is authoritative for "this is what was
//   stored"; the loader recomputes after copy and compares).

export interface TeamPlusUser {
  /** TeamPlus internal user id (e.g. EMPNO or row PK). */
  externalId: string;
  username: string;
  fullName: string;
  email: string | null;
  /** TeamPlus organisation id; mapped to drawing-mgmt Organization.id. */
  organizationExternalId: string | null;
  /** TeamPlus role string; transformed to drawing-mgmt Role enum. */
  roleHint: string;
  /** Active vs retired flag at source. */
  active: boolean;
}

export interface TeamPlusOrganization {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  sortOrder: number;
}

export interface TeamPlusFolder {
  externalId: string;
  name: string;
  /** Source path-style code (e.g. "ROOT/PROJ-A/DRAFTS"). Used for folderCode. */
  pathCode: string;
  parentExternalId: string | null;
  sortOrder: number;
}

export interface TeamPlusDrawing {
  externalId: string;
  /** Source drawing number — mapped to ObjectEntity.number. */
  number: string;
  name: string;
  description: string | null;
  folderExternalId: string;
  /** Source class/category string — mapped to ObjectClass code. */
  classCode: string;
  ownerExternalId: string;
  securityLevel: number;
  /** TeamPlus state (DRAFT/CHECKED_IN/APPROVED/...). */
  stateHint: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamPlusRevision {
  externalId: string;
  drawingExternalId: string;
  rev: number;
  createdAt: Date;
}

export interface TeamPlusVersion {
  externalId: string;
  revisionExternalId: string;
  /** Decimal version (e.g. 1.0, 1.1, 2.0). */
  ver: string;
  createdAt: Date;
  createdByExternalId: string;
  comment: string | null;
}

export interface TeamPlusAttachment {
  externalId: string;
  versionExternalId: string;
  filename: string;
  /** Path on the TeamPlus NAS, relative to MIGRATION_SOURCE_FILES_ROOT. */
  sourcePath: string;
  mimeType: string;
  size: number;
  /** True when the attachment is the master (DWG/DXF) of the version. */
  isMaster: boolean;
}

/** What `resolveFile` returns. */
export interface SourceFile {
  buffer: Buffer;
  /** SHA-256 hex string. The pipeline re-checksums on copy and compares. */
  checksum: string;
}

/**
 * The contract every source adapter must implement.
 *
 * Implementations:
 *   - `MockSource` (in-memory, 50 drawings + 10 users + 5 folders, used by
 *     unit tests and `pnpm dry-run` until the real dump lands).
 *   - `TeamPlusSource` (TODO — real Postgres / Oracle / SQL Server adapter,
 *     wired up once ops hands over the schema).
 */
export interface Source {
  /** Cheap aggregate counts for progress reporting. */
  countUsers(): Promise<number>;
  countOrganizations(): Promise<number>;
  countFolders(): Promise<number>;
  countDrawings(): Promise<number>;
  countAttachments(): Promise<number>;

  /** Streaming iterators. Order is not guaranteed. */
  iterateUsers(): AsyncIterable<TeamPlusUser>;
  iterateOrganizations(): AsyncIterable<TeamPlusOrganization>;
  iterateFolders(): AsyncIterable<TeamPlusFolder>;
  iterateDrawings(): AsyncIterable<TeamPlusDrawing>;
  iterateRevisions(): AsyncIterable<TeamPlusRevision>;
  iterateVersions(): AsyncIterable<TeamPlusVersion>;
  iterateAttachments(): AsyncIterable<TeamPlusAttachment>;

  /**
   * Resolve a file from `sourcePath` (relative to the NAS root). Returns
   * null when the file is missing — the pipeline records this as a
   * recoverable error and continues with the rest of the row's siblings.
   */
  resolveFile(sourcePath: string): Promise<SourceFile | null>;
}
