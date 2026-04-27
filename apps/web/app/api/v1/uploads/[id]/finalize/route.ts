// POST /api/v1/uploads/{id}/finalize
//
// R31 / V-INF-2 — finalize a chunked upload. Mirrors the R21 single-shot
// `POST /api/v1/objects/{id}/attachments` flow so the resulting Attachment
// row, on-disk layout, and conversion enqueue are indistinguishable.
//
// Flow:
//   1. Auth + load + own-check the Upload row.
//   2. Verify uploadedBytes == totalBytes and (optionally) sha256.
//   3. Permission + state gate on the destination ObjectEntity (folder
//      EDIT, not in IN_APPROVAL/APPROVED/DELETED, lock check).
//   4. Move the temp chunk file into the canonical attachment storage
//      `<FILE_STORAGE_ROOT>/<attachmentId>/source<ext>`.
//   5. Insert Attachment row inside a $transaction (with isMaster auto /
//      override identical to R21).
//   6. Auto-enqueue DWG conversion (best-effort, mirrors R28).
//   7. Mark Upload COMPLETED, write meta.json sidecar, ActivityLog
//      `OBJECT_ATTACH`.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ObjectState, UploadStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  loadFolderPermissions,
  toPermissionUser,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';
import { enqueueConversion } from '@/lib/conversion-queue';
// R36 V-INF-3 — best-effort ClamAV scan enqueue. Mirrors the R21 single-shot
// flow so finalize uploads receive the same scan treatment.
import { enqueueVirusScan } from '@/lib/scan-queue';
import {
  deleteUpload,
  readUploadBuffer,
  statUpload,
} from '@/lib/upload-store';
// R34 V-INF-1 — finalize hands the assembled buffer to the storage adapter
// so MinIO/S3 deployments work without changing this route.
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /**
   * Object to attach the upload to. Required for v1 — standalone uploads
   * (no parent object) are deferred to a future round per contract §5.3.
   */
  objectId: z.string().min(1),
  asAttachment: z
    .object({
      isMaster: z.boolean().optional(),
    })
    .optional(),
  /** Optional integrity check; if provided, must match the assembled file. */
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
});

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

function guessMime(ext: string): string {
  switch (ext) {
    case '.dwg':
      return 'application/acad';
    case '.dxf':
      return 'image/vnd.dxf';
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

export const POST = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req, { params }): Promise<NextResponse> => {
    let user;
    try {
      user = await requireUser();
    } catch (err) {
      if (err instanceof Response) return err as NextResponse;
      throw err;
    }

    const upload = await prisma.upload.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        userId: true,
        filename: true,
        mimeType: true,
        totalBytes: true,
        uploadedBytes: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!upload) return error(ErrorCode.E_NOT_FOUND);
    if (upload.userId !== user.id && !isAdmin(user.role)) {
      return error(ErrorCode.E_NOT_FOUND);
    }
    if (upload.status === UploadStatus.COMPLETED) {
      return error(ErrorCode.E_STATE_CONFLICT, '이미 finalize된 업로드입니다.');
    }
    if (
      upload.status === UploadStatus.FAILED ||
      upload.status === UploadStatus.EXPIRED
    ) {
      return error(
        ErrorCode.E_STATE_CONFLICT,
        '취소되었거나 만료된 업로드는 finalize할 수 없습니다.',
      );
    }

    let body: z.infer<typeof bodySchema>;
    try {
      const raw = await req.json().catch(() => null);
      body = bodySchema.parse(raw);
    } catch (err) {
      return error(
        ErrorCode.E_VALIDATION,
        'finalize 입력이 올바르지 않습니다.',
        undefined,
        err instanceof z.ZodError ? err.flatten() : undefined,
      );
    }

    // Size completeness — the client must finish the upload before finalize.
    const totalBytes = Number(upload.totalBytes);
    const uploadedBytes = Number(upload.uploadedBytes);
    if (uploadedBytes !== totalBytes) {
      return error(
        ErrorCode.E_VALIDATION,
        `업로드가 아직 완료되지 않았습니다 (uploaded=${uploadedBytes}, total=${totalBytes}).`,
        undefined,
        { uploadedBytes, totalBytes },
      );
    }

    // Verify the on-disk file matches.
    const stat = await statUpload(upload.id);
    if (!stat) {
      await prisma.upload
        .update({
          where: { id: upload.id },
          data: { status: UploadStatus.FAILED, errorMessage: 'temp file missing' },
        })
        .catch(() => undefined);
      return error(
        ErrorCode.E_STATE_CONFLICT,
        '임시 업로드 파일이 사라졌습니다. 다시 업로드해 주세요.',
      );
    }
    if (stat.size !== totalBytes) {
      return error(
        ErrorCode.E_VALIDATION,
        `임시 파일 크기와 totalBytes가 일치하지 않습니다 (file=${stat.size}, total=${totalBytes}).`,
      );
    }

    // Load destination object + permissions (mirror R21).
    const obj = await prisma.objectEntity.findUnique({
      where: { id: body.objectId },
      select: {
        id: true,
        folderId: true,
        ownerId: true,
        securityLevel: true,
        state: true,
        lockedById: true,
        currentRevision: true,
        currentVersion: true,
      },
    });
    if (!obj) {
      return error(ErrorCode.E_NOT_FOUND, '대상 자료를 찾을 수 없습니다.');
    }

    const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fullUser) return error(ErrorCode.E_AUTH);
    const [pUser, perms] = await Promise.all([
      toPermissionUser(fullUser),
      loadFolderPermissions([obj.folderId]),
    ]);
    const decision = canAccess(pUser, obj, perms, 'EDIT');
    if (!decision.allowed) return error(ErrorCode.E_FORBIDDEN, decision.reason);

    if (
      obj.state === ObjectState.IN_APPROVAL ||
      obj.state === ObjectState.APPROVED ||
      obj.state === ObjectState.DELETED
    ) {
      return error(
        ErrorCode.E_STATE_CONFLICT,
        '결재중/승인완료/폐기 상태에서는 첨부를 추가할 수 없습니다.',
      );
    }
    if (
      obj.state === ObjectState.CHECKED_OUT &&
      obj.lockedById !== user.id
    ) {
      return error(
        ErrorCode.E_LOCKED,
        '본인이 체크아웃한 자료에만 첨부를 추가할 수 있습니다.',
      );
    }

    // Read the assembled buffer, compute SHA-256, optionally verify.
    let buf: Buffer;
    try {
      buf = await readUploadBuffer(upload.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return error(ErrorCode.E_INTERNAL, '임시 파일 읽기 실패: ' + message);
    }
    const checksum = createHash('sha256').update(buf).digest('hex');
    if (body.sha256 && body.sha256.toLowerCase() !== checksum) {
      return error(
        ErrorCode.E_VALIDATION,
        '체크섬 불일치. 클라이언트 sha256과 서버 계산값이 다릅니다.',
        undefined,
        { expected: body.sha256.toLowerCase(), got: checksum },
      );
    }

    // Move the bytes into the attachment storage layout.
    const attachmentId = randomUUID();
    const ext = path.extname(upload.filename).toLowerCase() || '';
    const storedName = ext ? `source${ext}` : 'source';
    const sourceKey = `${attachmentId}/${storedName}`;
    const metaKey = `${attachmentId}/meta.json`;
    const mimeType = upload.mimeType || guessMime(ext);

    // R34 — storage abstraction. Re-write rather than rename: across-mount
    // rename isn't atomic and S3 has no rename at all. After the put
    // succeeds we delete the temp file.
    const storage = getStorage();
    await storage.put(sourceKey, buf, {
      contentType: mimeType,
      size: totalBytes,
    });

    const sidecar = {
      filename: upload.filename,
      mimeType,
      size: totalBytes,
      storagePath: sourceKey,
    };
    await storage
      .put(metaKey, Buffer.from(JSON.stringify(sidecar, null, 2), 'utf8'), {
        contentType: 'application/json',
      })
      .catch(() => undefined);

    const wantMaster = body.asAttachment?.isMaster === true;

    const created = await prisma.$transaction(async (tx) => {
      // Locate (or create) the current Revision + Version.
      let revision = await tx.revision.findUnique({
        where: {
          objectId_rev: { objectId: obj.id, rev: obj.currentRevision },
        },
      });
      if (!revision) {
        revision = await tx.revision.create({
          data: { objectId: obj.id, rev: obj.currentRevision },
        });
      }
      const versionStr = obj.currentVersion?.toString() ?? '0.0';
      let version = await tx.version.findUnique({
        where: {
          revisionId_ver: { revisionId: revision.id, ver: versionStr },
        },
      });
      if (!version) {
        version = await tx.version.create({
          data: {
            revisionId: revision.id,
            ver: versionStr,
            createdBy: user.id,
          },
        });
      }

      // isMaster decision identical to R21.
      const existingMaster = await tx.attachment.findFirst({
        where: { versionId: version.id, isMaster: true },
        select: { id: true },
      });
      const becomesMaster = wantMaster || !existingMaster;
      if (becomesMaster && existingMaster) {
        await tx.attachment.update({
          where: { id: existingMaster.id },
          data: { isMaster: false },
        });
      }

      const att = await tx.attachment.create({
        data: {
          id: attachmentId,
          versionId: version.id,
          filename: upload.filename,
          storagePath: sourceKey,
          mimeType,
          size: BigInt(totalBytes),
          isMaster: becomesMaster,
          checksumSha256: checksum,
          conversionStatus: 'PENDING',
        },
        select: {
          id: true,
          filename: true,
          size: true,
          mimeType: true,
          isMaster: true,
          versionId: true,
        },
      });

      // Mark the Upload row COMPLETED in the same transaction so the row
      // and the attachment land or fail together.
      await tx.upload.update({
        where: { id: upload.id },
        data: { status: UploadStatus.COMPLETED },
      });

      return att;
    });

    // Best-effort cleanup of the temp file. If this fails the cleanup
    // sweep / cancel endpoint will reap it.
    await deleteUpload(upload.id);

    // R28 V-INF-4 — auto-enqueue DWG conversion. Best-effort.
    let conversionJobId: string | undefined;
    let conversionEnqueued = false;
    if (ext === '.dwg') {
      const queueResult = await enqueueConversion({
        attachmentId: created.id,
        storagePath: sourceKey,
        filename: created.filename,
        mimeType: created.mimeType,
      });
      conversionEnqueued = queueResult.ok;
      conversionJobId = queueResult.jobId;
      if (!queueResult.ok) {
        // eslint-disable-next-line no-console
        console.error(
          '[uploads/finalize] conversion enqueue failed',
          { attachmentId: created.id, error: queueResult.error },
        );
      }
    }

    // R36 V-INF-3 — auto-enqueue ClamAV scan for the new attachment.
    // Mirrors the R21 single-shot upload flow.
    const scanResult = await enqueueVirusScan({
      attachmentId: created.id,
      storagePath: sourceKey,
      filename: created.filename,
      size: totalBytes,
    });
    if (!scanResult.ok) {
      // eslint-disable-next-line no-console
      console.error(
        '[uploads/finalize] virus scan enqueue failed',
        { attachmentId: created.id, error: scanResult.error },
      );
    }

    const meta = extractRequestMeta(req);
    await logActivity({
      userId: user.id,
      action: 'OBJECT_ATTACH',
      objectId: obj.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        attachmentId: created.id,
        filename: created.filename,
        isMaster: created.isMaster,
        bytes: totalBytes,
        viaUpload: upload.id,
        virusScanEnqueued: scanResult.ok,
        ...(ext === '.dwg'
          ? { conversionEnqueued, conversionJobId: conversionJobId ?? null }
          : {}),
      },
    });

    return ok(
      {
        attachmentId: created.id,
        filename: created.filename,
        mimeType: created.mimeType,
        size: created.size.toString(),
        isMaster: created.isMaster,
        ...(ext === '.dwg' ? { conversionJobId } : {}),
      },
      ext === '.dwg' ? { conversionEnqueued } : undefined,
      { status: 201 },
    );
  },
);
