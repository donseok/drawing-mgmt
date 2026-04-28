// ETL pipeline orchestration.
//
// `Pipeline` wires a `Source` to a `Loader` (+ a conversion queue
// adapter) and runs the dependency-ordered scan:
//
//   1. Organizations  (parents before children — source order respected)
//   2. Users          (need orgIdMap)
//   3. Folders        (need parentFolderIdMap; tree flattened breadth-first)
//   4. Classes        (lazy: registered on first sight in transformObject)
//   5. Drawings       (need folder + class + user mappings)
//   6. Revisions      (need objectIdMap)
//   7. Versions       (need revisionIdMap + userIdMap)
//   8. Attachments    (need versionIdMap + file body)
//
// `dryRun()`, `full()`, and `verify()` are the three public entry points
// the CLI calls. `full()` requires real Prisma + storage config; the
// loader throws if those aren't set, so we don't accidentally pretend a
// dry-run is a real run.

import type { Source } from './source/types.js';
import type {
  ConversionQueueAdapter,
} from './target/conversion-queue.js';
import { MockConversionQueue } from './target/conversion-queue.js';
import { Loader } from './target/prisma-loader.js';
import type { LoaderOptions } from './target/prisma-loader.js';
import { transformAttachment } from './transform/attachment.js';
import { transformFolder } from './transform/folder.js';
import { transformObject } from './transform/object.js';
import { transformUser } from './transform/user.js';
import {
  type MigrationReport,
  type VerificationReport,
  type VerificationSampleResult,
} from './report.js';

export interface PipelineConfig {
  source: Source;
  loader: LoaderOptions;
  /** Default: a fresh MockConversionQueue per run. */
  conversionQueue?: ConversionQueueAdapter;
  /** Default: drawing-mgmt's FILE_STORAGE_ROOT — read from env in cli.ts. */
  storageRoot: string;
  /** Optional progress callback for long-running CLI feedback. */
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  phase:
    | 'start'
    | 'organizations'
    | 'users'
    | 'folders'
    | 'objects'
    | 'revisions'
    | 'versions'
    | 'attachments'
    | 'conversions'
    | 'done';
  current?: number;
  total?: number;
  message?: string;
}

export interface DryRunOptions {
  /** Default: process every row. When set, only the first N drawings are processed. */
  sample?: number;
}

export interface FullRunOptions {
  /** Default: 100. Reserved for future batched insert tuning. */
  batchSize?: number;
  /** Default: false. When true, skip rows whose externalId is already in the target. */
  resume?: boolean;
}

export interface VerifyOptions {
  sampleSize: number;
}

export class Pipeline {
  constructor(private readonly cfg: PipelineConfig) {}

  async dryRun(opts: DryRunOptions = {}): Promise<MigrationReport> {
    return this.run({ mode: 'dry-run', sample: opts.sample });
  }

  async full(_opts: FullRunOptions = {}): Promise<MigrationReport> {
    if (this.cfg.loader.dryRun) {
      throw new Error(
        'Pipeline.full() requires loader.dryRun=false; got true. ' +
          'Use dryRun() for in-memory runs.',
      );
    }
    return this.run({ mode: 'full' });
  }

  async verify(opts: VerifyOptions): Promise<VerificationReport> {
    const startedAt = new Date();
    const startISO = startedAt.toISOString();

    // Verify by re-running the source iterator and comparing key fields
    // against the loader's id mapping. In the dry-run world the loader
    // synthesizes deterministic ids, so we can verify the *transform*
    // even without a live DB.
    const loader = new Loader(this.cfg.loader);
    await this.executeLoad(loader);

    const drawings: VerificationSampleResult[] = [];
    let matched = 0;
    let mismatched = 0;
    let i = 0;
    for await (const src of this.cfg.source.iterateDrawings()) {
      if (i >= opts.sampleSize) break;
      i++;

      const targetId = loader.objectIdMap.get(src.externalId);
      const mismatches: string[] = [];
      if (!targetId) {
        mismatches.push('object: missing target id');
      }
      // Folder mapping check — common drift point.
      const folderTarget = loader.folderIdMap.get(src.folderExternalId);
      if (!folderTarget) {
        mismatches.push(
          `folder: missing mapping for ${src.folderExternalId}`,
        );
      }
      // Owner check.
      const ownerTarget = loader.userIdMap.get(src.ownerExternalId);
      if (!ownerTarget) {
        mismatches.push(
          `owner: missing mapping for ${src.ownerExternalId}`,
        );
      }

      const ok = mismatches.length === 0;
      if (ok) matched++;
      else mismatched++;

      drawings.push({
        externalId: src.externalId,
        number: src.number,
        ok,
        mismatches,
      });
    }

    const finishedAt = new Date();
    return {
      startedAt: startISO,
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      sampleSize: drawings.length,
      matched,
      mismatched,
      results: drawings,
    };
  }

  private async run(args: {
    mode: 'dry-run' | 'full';
    sample?: number;
  }): Promise<MigrationReport> {
    const startedAt = new Date();
    const startISO = startedAt.toISOString();
    const queue = this.cfg.conversionQueue ?? new MockConversionQueue();

    const loader = new Loader(this.cfg.loader);

    const numberCollisions = new Set<string>();
    const folderCodeCollisions = new Set<string>();
    const rowErrors: MigrationReport['rowErrors'] = [];

    this.emit({ phase: 'start', message: `mode=${args.mode}` });

    // ─── Source counts (for progress) ─────────────────────────────
    const [
      userCount,
      orgCount,
      folderCount,
      drawingCount,
      attachmentCount,
    ] = await Promise.all([
      this.cfg.source.countUsers(),
      this.cfg.source.countOrganizations(),
      this.cfg.source.countFolders(),
      this.cfg.source.countDrawings(),
      this.cfg.source.countAttachments(),
    ]);

    // ─── Phase 1: organizations ─────────────────────────────────
    this.emit({ phase: 'organizations', total: orgCount });
    let i = 0;
    for await (const org of this.cfg.source.iterateOrganizations()) {
      try {
        const parentId = org.parentExternalId
          ? loader.orgIdMap.get(org.parentExternalId) ?? null
          : null;
        await loader.loadOrganization({
          externalId: org.externalId,
          name: org.name,
          parentId,
          sortOrder: org.sortOrder,
        });
      } catch (e) {
        rowErrors.push({
          entity: 'organization',
          externalId: org.externalId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
      this.emit({ phase: 'organizations', current: ++i, total: orgCount });
    }

    // ─── Phase 2: users ─────────────────────────────────────────
    this.emit({ phase: 'users', total: userCount });
    i = 0;
    for await (const user of this.cfg.source.iterateUsers()) {
      try {
        const target = transformUser(user, loader.orgIdMap);
        await loader.loadUser(target);
      } catch (e) {
        rowErrors.push({
          entity: 'user',
          externalId: user.externalId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
      this.emit({ phase: 'users', current: ++i, total: userCount });
    }

    // ─── Phase 3: folders (BFS via repeated passes) ─────────────
    this.emit({ phase: 'folders', total: folderCount });
    const assignedCodes = new Set<string>();
    const allFolders: Array<{
      externalId: string;
      name: string;
      pathCode: string;
      parentExternalId: string | null;
      sortOrder: number;
    }> = [];
    for await (const f of this.cfg.source.iterateFolders()) {
      allFolders.push(f);
    }
    // Naive BFS: keep iterating remaining folders, only persist ones whose
    // parent (if any) is already mapped. Bounded to allFolders.length
    // passes so cycles bail out cleanly.
    let remaining = [...allFolders];
    let lastSize = -1;
    while (remaining.length > 0 && remaining.length !== lastSize) {
      lastSize = remaining.length;
      const next: typeof remaining = [];
      for (const f of remaining) {
        const parentResolved =
          !f.parentExternalId || loader.folderIdMap.has(f.parentExternalId);
        if (!parentResolved) {
          next.push(f);
          continue;
        }
        try {
          const codeBefore = assignedCodes.size;
          const target = transformFolder(f, loader.folderIdMap, assignedCodes);
          if (
            assignedCodes.size === codeBefore + 1 &&
            target.folderCode !== f.pathCode.toUpperCase().replace(/\s+/g, '_')
          ) {
            // The transform suffixed a number — record it.
            folderCodeCollisions.add(f.pathCode);
          }
          await loader.loadFolder(target);
        } catch (e) {
          rowErrors.push({
            entity: 'folder',
            externalId: f.externalId,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
        this.emit({
          phase: 'folders',
          current: loader.folderIdMap.size,
          total: folderCount,
        });
      }
      remaining = next;
    }
    if (remaining.length > 0) {
      // Cycles or orphans — capture them all so ops can fix.
      for (const f of remaining) {
        rowErrors.push({
          entity: 'folder',
          externalId: f.externalId,
          reason: `unresolved parent ${f.parentExternalId ?? '<none>'}`,
        });
      }
    }

    // ─── Phase 4: drawings (registers classes lazily) ───────────
    this.emit({
      phase: 'objects',
      total: args.sample ?? drawingCount,
    });
    const seenNumbers = new Set<string>();
    i = 0;
    for await (const d of this.cfg.source.iterateDrawings()) {
      if (args.sample !== undefined && i >= args.sample) break;
      i++;
      try {
        loader.registerClass(d.classCode);
        const target = transformObject(d, {
          folderIdMap: loader.folderIdMap,
          classIdByCode: loader.classIdByCode,
          userIdMap: loader.userIdMap,
          seenNumbers,
          numberCollisions,
        });
        await loader.loadObject(target);
      } catch (e) {
        rowErrors.push({
          entity: 'object',
          externalId: d.externalId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
      this.emit({
        phase: 'objects',
        current: i,
        total: args.sample ?? drawingCount,
      });
    }

    // ─── Phase 5: revisions ─────────────────────────────────────
    this.emit({ phase: 'revisions' });
    for await (const r of this.cfg.source.iterateRevisions()) {
      try {
        const objectId = loader.objectIdMap.get(r.drawingExternalId);
        if (!objectId) continue; // sample mode skipped this drawing
        await loader.loadRevision({
          externalId: r.externalId,
          objectId,
          rev: r.rev,
          createdAt: r.createdAt,
        });
      } catch (e) {
        rowErrors.push({
          entity: 'revision',
          externalId: r.externalId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ─── Phase 6: versions ──────────────────────────────────────
    this.emit({ phase: 'versions' });
    for await (const v of this.cfg.source.iterateVersions()) {
      try {
        const revisionId = loader.revisionIdMap.get(v.revisionExternalId);
        if (!revisionId) continue;
        const createdBy =
          loader.userIdMap.get(v.createdByExternalId) ?? '__missing__';
        await loader.loadVersion({
          externalId: v.externalId,
          revisionId,
          ver: v.ver,
          createdAt: v.createdAt,
          createdBy,
          comment: v.comment,
        });
      } catch (e) {
        rowErrors.push({
          entity: 'version',
          externalId: v.externalId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ─── Phase 7: attachments + body copy ───────────────────────
    this.emit({ phase: 'attachments', total: attachmentCount });
    i = 0;
    const enqueueables: Array<{
      externalId: string;
      attachmentId: string;
      filename: string;
      mimeType: string;
    }> = [];
    for await (const a of this.cfg.source.iterateAttachments()) {
      i++;
      this.emit({
        phase: 'attachments',
        current: i,
        total: attachmentCount,
      });
      try {
        if (!loader.versionIdMap.has(a.versionExternalId)) {
          continue; // version not loaded (sample mode or earlier error)
        }
        const { rowSkeleton } = transformAttachment(a, {
          versionIdMap: loader.versionIdMap,
          storageRoot: this.cfg.storageRoot,
        });
        const sourceFile = await this.cfg.source.resolveFile(a.sourcePath);
        const result = await loader.loadAttachment(
          rowSkeleton,
          sourceFile?.buffer ?? null,
          sourceFile?.checksum ?? null,
        );
        if (result && a.isMaster) {
          const attachmentId = loader.attachmentIdMap.get(a.externalId);
          if (attachmentId) {
            enqueueables.push({
              externalId: a.externalId,
              attachmentId,
              filename: result.filename,
              mimeType: result.mimeType,
            });
          }
        }
      } catch (e) {
        rowErrors.push({
          entity: 'attachment',
          externalId: a.externalId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ─── Phase 8: conversion enqueue ────────────────────────────
    this.emit({ phase: 'conversions', total: enqueueables.length });
    for (const req of enqueueables) {
      try {
        await queue.enqueue(req);
      } catch (e) {
        rowErrors.push({
          entity: 'conversion',
          externalId: req.externalId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const finishedAt = new Date();
    this.emit({ phase: 'done' });

    return {
      mode: args.mode,
      startedAt: startISO,
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      source: {
        users: userCount,
        organizations: orgCount,
        folders: folderCount,
        drawings: drawingCount,
        attachments: attachmentCount,
      },
      load: loader.result(),
      numberCollisions: [...numberCollisions],
      folderCodeCollisions: [...folderCodeCollisions],
      conversionEnqueued: queue.size(),
      rowErrors,
    };
  }

  /**
   * Verify-only path that just exercises the source + loader-load to
   * populate the id maps. Same dependency order as `run`, minus the
   * report bookkeeping. Centralised so `verify()` and any future
   * "validate-without-loading" command share one loader-fill code path.
   */
  private async executeLoad(loader: Loader): Promise<void> {
    for await (const org of this.cfg.source.iterateOrganizations()) {
      const parentId = org.parentExternalId
        ? loader.orgIdMap.get(org.parentExternalId) ?? null
        : null;
      await loader.loadOrganization({
        externalId: org.externalId,
        name: org.name,
        parentId,
        sortOrder: org.sortOrder,
      });
    }
    for await (const user of this.cfg.source.iterateUsers()) {
      await loader.loadUser(transformUser(user, loader.orgIdMap));
    }
    const allFolders = [];
    for await (const f of this.cfg.source.iterateFolders()) {
      allFolders.push(f);
    }
    const codes = new Set<string>();
    let remaining = [...allFolders];
    let lastSize = -1;
    while (remaining.length > 0 && remaining.length !== lastSize) {
      lastSize = remaining.length;
      const next: typeof remaining = [];
      for (const f of remaining) {
        if (f.parentExternalId && !loader.folderIdMap.has(f.parentExternalId)) {
          next.push(f);
          continue;
        }
        await loader.loadFolder(
          transformFolder(f, loader.folderIdMap, codes),
        );
      }
      remaining = next;
    }
    const seen = new Set<string>();
    const collisions = new Set<string>();
    for await (const d of this.cfg.source.iterateDrawings()) {
      loader.registerClass(d.classCode);
      try {
        await loader.loadObject(
          transformObject(d, {
            folderIdMap: loader.folderIdMap,
            classIdByCode: loader.classIdByCode,
            userIdMap: loader.userIdMap,
            seenNumbers: seen,
            numberCollisions: collisions,
          }),
        );
      } catch {
        // ignored — verify path only cares about successfully-mapped rows
      }
    }
  }

  private emit(event: ProgressEvent): void {
    if (this.cfg.onProgress) this.cfg.onProgress(event);
  }
}
