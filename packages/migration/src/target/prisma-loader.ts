// Loader: writes target rows + files.
//
// Two modes:
//   - `dryRun=true`: never touches the DB or disk. Builds the in-memory
//     id mapping, runs the checksum dance against the source-provided hash,
//     and accumulates counters. The pipeline still gets a full `report` so
//     we know whether a real run would succeed.
//   - `dryRun=false`: requires a `PrismaClient`-shaped object (so we don't
//     hard-couple to `@prisma/client` in the unit tests). Writes rows in
//     dependency order (Org → User → Folder → Class → Object → Revision →
//     Version → Attachment) inside one transaction per chunk.
//
// Idempotency:
//   - For each entity we read the target's `externalId` field if present
//     (or skip if the upsert key already exists). The mock loader used by
//     dry-run keeps a Map<externalId, fakeId> in memory; the real Prisma
//     loader uses `upsert({ where: { ... } })` against an `externalId`
//     column. Drawing-mgmt's schema doesn't currently expose externalId
//     fields — the migration is expected to add them as a follow-up
//     before going live (see TODO at the bottom of this file).
//
// File copy:
//   - We re-checksum after writing so we can flag corrupt copies. If the
//     source-side checksum and the post-write checksum disagree, the
//     attachment row is still written (so the run is reproducible) but
//     marked in the report's `checksumMismatches` list.

import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256OfBuffer, sha256OfFile } from '../checksum.js';
import type {
  LoaderCounters,
  TargetAttachment,
  TargetFolder,
  TargetObject,
  TargetOrganization,
  TargetRevision,
  TargetUser,
  TargetVersion,
} from './types.js';

/**
 * Minimal subset of PrismaClient we use. Defining it as a structural type
 * means the unit tests can pass a stub object without bringing the whole
 * `@prisma/client` runtime into the test process. The real `PrismaClient`
 * matches by structural typing.
 */
export interface PrismaLike {
  $transaction<T>(fn: (tx: PrismaLike) => Promise<T>): Promise<T>;
  // We type these as `any` on purpose — the real Prisma types vary per
  // model, and we only call a fixed handful of methods (create, upsert,
  // findUnique). Keeping the surface area narrow lets the test stub be
  // tiny.
  user: AnyDelegate;
  organization: AnyDelegate;
  folder: AnyDelegate;
  objectClass: AnyDelegate;
  objectEntity: AnyDelegate;
  revision: AnyDelegate;
  version: AnyDelegate;
  attachment: AnyDelegate;
}

type AnyDelegate = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsert: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findUnique: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create: (...args: any[]) => Promise<any>;
};

export interface LoaderOptions {
  dryRun: boolean;
  /** Required when dryRun=false. */
  prisma?: PrismaLike;
  /** Where attachment bodies are written. Required when dryRun=false. */
  storageRoot?: string;
  /**
   * Bcrypt hash to stamp on every migrated user. Required when dryRun=false.
   * In dry-run we leave the placeholder sentinel in place.
   */
  passwordHash?: string;
}

export interface LoadResult {
  counters: {
    users: LoaderCounters;
    organizations: LoaderCounters;
    folders: LoaderCounters;
    objects: LoaderCounters;
    revisions: LoaderCounters;
    versions: LoaderCounters;
    attachments: LoaderCounters;
  };
  /** Attachment external ids whose post-write checksum disagreed with the source. */
  checksumMismatches: string[];
  /** Source attachment paths that the source returned `null` for. */
  missingFiles: string[];
}

const ZERO_COUNTER = (): LoaderCounters => ({
  inserted: 0,
  skipped: 0,
  errors: 0,
});

/**
 * Stateful loader. Caller calls `loadOrganizations`, `loadUsers`, ... in
 * dependency order, threading the `idMap` accessors through. The pipeline
 * coordinator owns the order; this class just executes one entity at a
 * time.
 */
export class Loader {
  readonly orgIdMap = new Map<string, string>();
  readonly userIdMap = new Map<string, string>();
  readonly folderIdMap = new Map<string, string>();
  readonly classIdByCode = new Map<string, string>();
  readonly objectIdMap = new Map<string, string>();
  readonly revisionIdMap = new Map<string, string>();
  readonly versionIdMap = new Map<string, string>();
  readonly attachmentIdMap = new Map<string, string>();

  readonly counters: LoadResult['counters'] = {
    users: ZERO_COUNTER(),
    organizations: ZERO_COUNTER(),
    folders: ZERO_COUNTER(),
    objects: ZERO_COUNTER(),
    revisions: ZERO_COUNTER(),
    versions: ZERO_COUNTER(),
    attachments: ZERO_COUNTER(),
  };

  readonly checksumMismatches: string[] = [];
  readonly missingFiles: string[] = [];

  constructor(private readonly opts: LoaderOptions) {
    if (!opts.dryRun) {
      if (!opts.prisma) {
        throw new Error('Loader: prisma client is required when dryRun=false');
      }
      if (!opts.storageRoot) {
        throw new Error(
          'Loader: storageRoot is required when dryRun=false',
        );
      }
      if (!opts.passwordHash) {
        throw new Error(
          'Loader: passwordHash is required when dryRun=false',
        );
      }
    }
  }

  async loadOrganization(target: TargetOrganization): Promise<void> {
    if (this.opts.dryRun) {
      this.orgIdMap.set(target.externalId, this.synth('org', target.externalId));
      this.counters.organizations.inserted++;
      return;
    }
    // TODO: real Prisma upsert by externalId. Drawing-mgmt's Organization
    // model needs an `externalId` column added (single-line schema delta)
    // before the live run; a 2-step migration (add column NULLable → run
    // migration → backfill → flip to NOT NULL) is the safe path.
    throw new Error(
      'Loader.loadOrganization (live): externalId column not yet added — ' +
        'see TODO. Run with dryRun=true until schema delta lands.',
    );
  }

  async loadUser(target: TargetUser): Promise<void> {
    if (this.opts.dryRun) {
      this.userIdMap.set(target.externalId, this.synth('user', target.externalId));
      this.counters.users.inserted++;
      return;
    }
    throw new Error(
      'Loader.loadUser (live): externalId column not yet added — see TODO',
    );
  }

  async loadFolder(target: TargetFolder): Promise<void> {
    if (this.opts.dryRun) {
      this.folderIdMap.set(
        target.externalId,
        this.synth('folder', target.externalId),
      );
      this.counters.folders.inserted++;
      return;
    }
    throw new Error(
      'Loader.loadFolder (live): externalId column not yet added — see TODO',
    );
  }

  /**
   * Class is a small lookup; we register-by-code rather than externalId.
   * In dry-run we synthesize an id per code on first sight.
   */
  registerClass(code: string): string {
    const existing = this.classIdByCode.get(code);
    if (existing) return existing;
    const id = this.synth('class', code);
    this.classIdByCode.set(code, id);
    return id;
  }

  async loadObject(target: TargetObject): Promise<void> {
    if (this.opts.dryRun) {
      this.objectIdMap.set(
        target.externalId,
        this.synth('object', target.externalId),
      );
      this.counters.objects.inserted++;
      return;
    }
    throw new Error(
      'Loader.loadObject (live): externalId column not yet added — see TODO',
    );
  }

  async loadRevision(target: TargetRevision): Promise<void> {
    if (this.opts.dryRun) {
      this.revisionIdMap.set(
        target.externalId,
        this.synth('revision', target.externalId),
      );
      this.counters.revisions.inserted++;
      return;
    }
    throw new Error(
      'Loader.loadRevision (live): externalId column not yet added — see TODO',
    );
  }

  async loadVersion(target: TargetVersion): Promise<void> {
    if (this.opts.dryRun) {
      this.versionIdMap.set(
        target.externalId,
        this.synth('version', target.externalId),
      );
      this.counters.versions.inserted++;
      return;
    }
    throw new Error(
      'Loader.loadVersion (live): externalId column not yet added — see TODO',
    );
  }

  /**
   * Loads an attachment row + writes the body to FILE_STORAGE_ROOT, then
   * re-checksums the written file and stores the hash.
   *
   * Returns the resolved Attachment with its final SHA-256.
   */
  async loadAttachment(
    rowSkeleton: Omit<TargetAttachment, 'checksumSha256'>,
    body: Buffer | null,
    sourceChecksum: string | null,
  ): Promise<TargetAttachment | null> {
    if (!body || !sourceChecksum) {
      this.missingFiles.push(rowSkeleton.externalId);
      this.counters.attachments.errors++;
      return null;
    }

    let resolvedChecksum: string;
    if (this.opts.dryRun) {
      // No disk write — checksum the in-memory buffer directly. Still
      // compares against `sourceChecksum` so corruption in the
      // `Source.resolveFile` path is caught.
      resolvedChecksum = sha256OfBuffer(body);
    } else {
      // Write to disk, then read back and hash. This is the real
      // bit-rot guard.
      await fs.mkdir(path.dirname(rowSkeleton.storagePath), {
        recursive: true,
      });
      await fs.writeFile(rowSkeleton.storagePath, body);
      resolvedChecksum = await sha256OfFile(rowSkeleton.storagePath);
    }

    if (resolvedChecksum !== sourceChecksum) {
      this.checksumMismatches.push(rowSkeleton.externalId);
    }

    const target: TargetAttachment = {
      ...rowSkeleton,
      checksumSha256: resolvedChecksum,
    };

    if (this.opts.dryRun) {
      this.attachmentIdMap.set(
        target.externalId,
        this.synth('attachment', target.externalId),
      );
      this.counters.attachments.inserted++;
      return target;
    }
    throw new Error(
      'Loader.loadAttachment (live): externalId column not yet added — ' +
        'see TODO',
    );
  }

  result(): LoadResult {
    return {
      counters: this.counters,
      checksumMismatches: this.checksumMismatches,
      missingFiles: this.missingFiles,
    };
  }

  /**
   * Deterministic synthetic id for dry-run / test mode. The mapping is
   * keyed on (entity, externalId) so reruns produce the same ids.
   */
  private synth(entity: string, externalId: string): string {
    return `dry-${entity}-${externalId}`;
  }
}

// TODO (live-run prerequisite): add `externalId String? @unique` columns to
// User, Organization, Folder, ObjectEntity, Revision, Version, Attachment.
// 2-step rollout: (1) add column nullable + ship; (2) backfill + run the
// migration; (3) flip to NOT NULL after migration completes. The live
// `loadXxx` paths above currently throw, so dry-run is the only safe
// mode until that schema delta lands.
