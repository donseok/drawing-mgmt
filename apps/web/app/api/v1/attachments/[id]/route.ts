// /api/v1/attachments/:id
//   PATCH  — toggle isMaster (1 master per Version; flip demotes the prior).
//   DELETE — remove the attachment row + on-disk file. Master attachments
//            are protected: caller must promote a sibling first to avoid
//            leaving a Version with no master.
//
// State machine mirrors the upload endpoint (R21): NEW / CHECKED_IN /
// CHECKED_OUT-by-locker only. Pre-existing read/preview routes already
// enforce VIEW for download access; this route requires EDIT.
//
// Owned by BE (R22).

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ObjectState } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  loadFolderPermissions,
  toPermissionUser,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import type { ApiErrorCode } from '@/lib/api-errors';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';

export const runtime = 'nodejs';

const STORAGE_ROOT = path.isAbsolute(process.env.FILE_STORAGE_ROOT ?? '')
  ? path.resolve(process.env.FILE_STORAGE_ROOT!)
  : path.resolve(
      process.cwd(),
      process.env.FILE_STORAGE_ROOT ?? './.data/files',
    );

const patchSchema = z.object({
  /** Currently the only mutable field; null/false demotes (no-op when not master). */
  isMaster: z.boolean(),
});

async function loadAttachmentWithObject(id: string) {
  return prisma.attachment.findUnique({
    where: { id },
    include: {
      version: {
        include: {
          revision: {
            include: {
              object: {
                select: {
                  id: true,
                  folderId: true,
                  ownerId: true,
                  securityLevel: true,
                  state: true,
                  lockedById: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

async function gateEdit(
  user: { id: string; role: string; organizationId: string | null },
  obj: {
    id: string;
    folderId: string;
    ownerId: string;
    securityLevel: number;
    state: ObjectState;
    lockedById: string | null;
  },
): Promise<NextResponse | null> {
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
      '결재중/승인완료/폐기 상태에서는 첨부를 변경할 수 없습니다.',
    );
  }
  if (obj.state === ObjectState.CHECKED_OUT && obj.lockedById !== user.id) {
    return error(
      ErrorCode.E_LOCKED,
      '본인이 체크아웃한 자료에서만 첨부를 변경할 수 있습니다.',
    );
  }
  return null;
}

export const PATCH = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const att = await loadAttachmentWithObject(params.id);
  if (!att) return error(ErrorCode.E_NOT_FOUND);
  const obj = att.version.revision.object;

  const blocked = await gateEdit(user, obj);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const { isMaster } = parsed.data;

  // No-op fast path — avoids spurious activity log entries when the FE
  // re-sends the current value on a click race.
  if (att.isMaster === isMaster) {
    return ok({ id: att.id, isMaster: att.isMaster, changed: false });
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (isMaster) {
        // Demote any sibling masters in the same Version before promoting.
        await tx.attachment.updateMany({
          where: {
            versionId: att.versionId,
            isMaster: true,
            NOT: { id: att.id },
          },
          data: { isMaster: false },
        });
        await tx.attachment.update({
          where: { id: att.id },
          data: { isMaster: true },
        });
      } else {
        // Demote without promoting a replacement — caller is responsible for
        // setting a new master afterward. We refuse here only if this is the
        // *only* master in the Version, so the Version doesn't end up
        // master-less behind the user's back.
        const otherMasters = await tx.attachment.count({
          where: {
            versionId: att.versionId,
            isMaster: true,
            NOT: { id: att.id },
          },
        });
        if (otherMasters === 0) {
          throw new GuardError(
            ErrorCode.E_STATE_CONFLICT,
            '다른 마스터를 먼저 지정한 뒤 해제하세요.',
          );
        }
        await tx.attachment.update({
          where: { id: att.id },
          data: { isMaster: false },
        });
      }
    });
  } catch (e) {
    if (e instanceof GuardError) {
      return error(e.code, e.message);
    }
    throw e;
  }

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'OBJECT_ATTACH',
    objectId: obj.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      attachmentId: att.id,
      isMaster,
      promote: true,
    },
  });

  return ok({ id: att.id, isMaster });
  },
);

export const DELETE = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const att = await loadAttachmentWithObject(params.id);
  if (!att) return error(ErrorCode.E_NOT_FOUND);
  const obj = att.version.revision.object;

  const blocked = await gateEdit(user, obj);
  if (blocked) return blocked;

  // Don't strand a Version with no master — caller must promote first.
  if (att.isMaster) {
    const siblings = await prisma.attachment.count({
      where: {
        versionId: att.versionId,
        NOT: { id: att.id },
      },
    });
    if (siblings > 0) {
      return error(
        ErrorCode.E_STATE_CONFLICT,
        '마스터 첨부는 다른 첨부를 마스터로 지정한 뒤 삭제할 수 있습니다.',
      );
    }
    // The only attachment in the Version → safe to delete (Version stays
    // empty, ready for the next upload).
  }

  await prisma.attachment.delete({ where: { id: att.id } });

  // Best-effort storage cleanup — DB write already succeeded so a stuck
  // file is a leak, not a correctness bug. We swallow errors and log.
  try {
    const dir = path.join(STORAGE_ROOT, att.id);
    await fs.rm(dir, { recursive: true, force: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[attachment delete] storage cleanup failed:', (e as Error).message);
  }

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'OBJECT_DETACH',
    objectId: obj.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { attachmentId: att.id, filename: att.filename },
  });

  return ok({ id: att.id });
  },
);

class GuardError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GuardError';
  }
}
