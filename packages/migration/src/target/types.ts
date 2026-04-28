// Shapes the transform layer produces and the loader consumes. These are
// intentionally a thin layer above the Prisma model fields — close enough
// that a `prismaClient.user.create({ data })` mostly Just Works, but loose
// enough that we don't import Prisma's generated types from the transform
// modules (lets transform unit tests run without a Prisma client present).
//
// "External id" fields are preserved at every level so the loader can build
// a deterministic mapping (TeamPlus id → drawing-mgmt cuid). The mapping is
// what makes the migration idempotent: rerunning skips rows whose external
// ids already have a target row.

export interface TargetUser {
  externalId: string;
  username: string;
  fullName: string;
  email: string | null;
  /** Resolved target Organization.id (or null when source had none). */
  organizationId: string | null;
  /** Drawing-mgmt Role enum literal. */
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'PARTNER';
  /** Drawing-mgmt EmploymentType enum literal. */
  employmentType: 'ACTIVE' | 'RETIRED' | 'PARTNER';
  securityLevel: number;
  /**
   * Migrated users get a "must change" placeholder bcrypt hash; the FE
   * forces a reset on first login. The migration never copies plaintext
   * or legacy hashes — TeamPlus's hash format is incompatible with bcrypt.
   */
  passwordHashPlaceholder: string;
}

export interface TargetOrganization {
  externalId: string;
  name: string;
  /** Resolved target Organization.id of parent (null for root). */
  parentId: string | null;
  sortOrder: number;
}

export interface TargetFolder {
  externalId: string;
  name: string;
  /** drawing-mgmt Folder.folderCode — must be unique across the system. */
  folderCode: string;
  parentId: string | null;
  sortOrder: number;
}

export interface TargetObject {
  externalId: string;
  number: string;
  name: string;
  description: string | null;
  /** Resolved target Folder.id. */
  folderId: string;
  /** Resolved target ObjectClass.id. */
  classId: string;
  /** Resolved target User.id. */
  ownerId: string;
  securityLevel: number;
  state: 'NEW' | 'CHECKED_OUT' | 'CHECKED_IN' | 'IN_APPROVAL' | 'APPROVED';
  createdAt: Date;
  updatedAt: Date;
}

export interface TargetRevision {
  externalId: string;
  /** Resolved target ObjectEntity.id. */
  objectId: string;
  rev: number;
  createdAt: Date;
}

export interface TargetVersion {
  externalId: string;
  /** Resolved target Revision.id. */
  revisionId: string;
  /** Decimal as string (e.g. "1.0"). */
  ver: string;
  createdAt: Date;
  /** Resolved target User.id. */
  createdBy: string;
  comment: string | null;
}

export interface TargetAttachment {
  externalId: string;
  /** Resolved target Version.id. */
  versionId: string;
  filename: string;
  /**
   * Path inside FILE_STORAGE_ROOT where the body lives. The loader writes
   * the buffer here, then this string is stored on Attachment.storagePath.
   */
  storagePath: string;
  mimeType: string;
  size: number;
  isMaster: boolean;
  /** SHA-256 hex — computed at load time, not source time. */
  checksumSha256: string;
}

/** Loader-side counters reported back up to the pipeline / report. */
export interface LoaderCounters {
  inserted: number;
  skipped: number;
  errors: number;
}
