// POST /api/v1/objects/:id/attachments
//
// R21 — accept a single multipart upload and attach it to the object's
// current Revision/Version. State rules:
//   NEW                      → create v0.0 if none, then attach.
//   CHECKED_OUT (self-locker) → attach to current Version.
//   CHECKED_IN               → attach to current Version.
//   IN_APPROVAL / APPROVED   → reject (자료 잠김).
//
// Each attachment row records SHA-256 checksum + storagePath (`<attachmentId>/source.<ext>`).
// `isMaster` is auto-true when no master exists yet, otherwise the form
// field `isMaster=true` promotes this row and demotes any sibling masters.
//
// Owned by BE (R21).

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ObjectState } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  loadFolderPermissions,
  toPermissionUser,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = Number(
  process.env.ATTACHMENT_MAX_BYTES ?? 200 * 1024 * 1024,
);

const STORAGE_ROOT = path.isAbsolute(process.env.FILE_STORAGE_ROOT ?? '')
  ? path.resolve(process.env.FILE_STORAGE_ROOT!)
  : path.resolve(
      process.cwd(),
      process.env.FILE_STORAGE_ROOT ?? './.data/files',
    );

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().includes('multipart/form-data')) {
    return error(ErrorCode.E_VALIDATION, 'multipart/form-data가 필요합니다.');
  }

  const obj = await prisma.objectEntity.findUnique({
    where: { id: params.id },
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
  if (!obj) return error(ErrorCode.E_NOT_FOUND);

  // Permission + state gating happens before we touch the FS so we never
  // leave half-uploaded files for rejected requests.
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return error(
      ErrorCode.E_VALIDATION,
      'multipart 파싱 실패: ' + (e instanceof Error ? e.message : '알 수 없음'),
    );
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return error(ErrorCode.E_VALIDATION, 'file 필드가 필요합니다.');
  }
  if (file.size === 0) {
    return error(ErrorCode.E_VALIDATION, '빈 파일입니다.');
  }
  if (file.size > MAX_BYTES) {
    return error(
      ErrorCode.E_VALIDATION,
      `파일 크기 제한 초과 (${MAX_BYTES} bytes)`,
    );
  }
  const wantMaster = form.get('isMaster') === 'true';

  // Attachment id is the storage directory name. Mirrors dev ingest layout
  // so the existing `/api/v1/attachments/[id]/file` reader picks it up.
  const attachmentId = randomUUID();
  const targetDir = path.join(STORAGE_ROOT, attachmentId);
  await fs.mkdir(targetDir, { recursive: true });
  const ext = path.extname(file.name).toLowerCase() || '';
  const storedName = ext ? `source${ext}` : 'source';
  const storedPath = path.join(targetDir, storedName);

  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storedPath, buf);
  const checksum = createHash('sha256').update(buf).digest('hex');

  // sidecar so the existing `/api/v1/attachments/[id]/file` route resolves
  // the original filename + mime type without a DB read.
  const sidecar = {
    filename: file.name,
    mimeType: file.type || guessMime(ext),
    size: file.size,
    storagePath: `${attachmentId}/${storedName}`,
  };
  await fs
    .writeFile(
      path.join(targetDir, 'meta.json'),
      JSON.stringify(sidecar, null, 2),
      'utf8',
    )
    .catch(() => undefined);

  const created = await prisma.$transaction(async (tx) => {
    // Locate (or create) the current Revision + a Version we can attach to.
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
    const versionStr =
      obj.currentVersion?.toString() ?? '0.0';
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

    // Decide isMaster — explicit override OR no existing master in this
    // version (typical first upload).
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

    return tx.attachment.create({
      data: {
        id: attachmentId,
        versionId: version.id,
        filename: file.name,
        storagePath: `${attachmentId}/${storedName}`,
        mimeType: file.type || guessMime(ext),
        size: BigInt(file.size),
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
  });

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
      bytes: file.size,
    },
  });

  return ok(
    {
      id: created.id,
      filename: created.filename,
      mimeType: created.mimeType,
      size: created.size.toString(),
      isMaster: created.isMaster,
    },
    undefined,
    { status: 201 },
  );
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
