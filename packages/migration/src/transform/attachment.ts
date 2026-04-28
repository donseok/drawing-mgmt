// Attachment + body file mapping.
//
// Two products:
//   1. The `TargetAttachment` row (DB metadata).
//   2. The destination `storagePath` on the local FS — the loader writes
//      the source buffer here, re-checksums the on-disk copy, and stores
//      that hash in the row.
//
// We don't actually do disk IO in this module (transform is pure); that's
// the loader's job. Here we just compute the destination path.

import path from 'node:path';
import type { TeamPlusAttachment } from '../source/types.js';
import type { TargetAttachment } from '../target/types.js';

export interface AttachmentTransformContext {
  versionIdMap: ReadonlyMap<string, string>;
  /**
   * FILE_STORAGE_ROOT for the new system. Attachments land at
   * `${storageRoot}/${attachmentExternalId}/${filename}` so they mirror
   * the layout the conversion worker expects (one dir per attachment).
   */
  storageRoot: string;
}

export interface TransformAttachmentResult {
  /** Skeleton of the row — checksum is filled in by the loader after copy. */
  rowSkeleton: Omit<TargetAttachment, 'checksumSha256'>;
  /** Absolute destination path on disk. */
  destPath: string;
}

export function transformAttachment(
  src: TeamPlusAttachment,
  ctx: AttachmentTransformContext,
): TransformAttachmentResult {
  const versionId = ctx.versionIdMap.get(src.versionExternalId);
  if (!versionId) {
    throw new Error(
      `transformAttachment: missing version mapping for external id ${src.versionExternalId}`,
    );
  }

  // Sanitize filename — strip path traversal segments.
  const sanitized = src.filename
    .replace(/[\\/]+/g, '_')
    .replace(/^\.+/, '_');

  const destDir = path.join(ctx.storageRoot, src.externalId);
  const destPath = path.join(destDir, sanitized);

  const rowSkeleton: Omit<TargetAttachment, 'checksumSha256'> = {
    externalId: src.externalId,
    versionId,
    filename: sanitized,
    storagePath: destPath,
    mimeType: src.mimeType,
    size: src.size,
    isMaster: src.isMaster,
  };

  return { rowSkeleton, destPath };
}
