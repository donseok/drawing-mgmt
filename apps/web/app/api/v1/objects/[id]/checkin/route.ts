// POST /api/v1/objects/:id/checkin
//
// CHECKED_OUT (locked by caller) → CHECKED_IN
// Creates a new Version with ver = currentVersion + 0.1 on the current revision.
// Releases the lock.
//
// Body (optional): { comment?: string }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ObjectState, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  toPermissionUser,
  loadFolderPermissions,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { canTransition } from '@/lib/state-machine';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { enqueueNotification } from '@/lib/notifications';

const bodySchema = z.object({
  comment: z.string().max(2000).optional(),
});

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

  const obj = await prisma.objectEntity.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      number: true,
      name: true,
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

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);
  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions([obj.folderId]),
  ]);
  const decision = canAccess(pUser, obj, perms, 'EDIT');
  if (!decision.allowed) return error(ErrorCode.E_FORBIDDEN, decision.reason);

  const t = canTransition(obj.state, 'checkin', {
    lockedById: obj.lockedById,
    userId: user.id,
  });
  if (!t.ok) {
    const code =
      t.reason === 'NOT_LOCKED_BY_USER'
        ? ErrorCode.E_LOCKED
        : ErrorCode.E_STATE_CONFLICT;
    return error(code, t.message);
  }

  let parsedBody: z.infer<typeof bodySchema> = {};
  if (req.headers.get('content-length') && req.headers.get('content-length') !== '0') {
    try {
      const raw = await req.json();
      const safe = bodySchema.safeParse(raw);
      if (!safe.success) {
        return error(
          ErrorCode.E_VALIDATION,
          undefined,
          undefined,
          safe.error.flatten(),
        );
      }
      parsedBody = safe.data;
    } catch {
      // Empty body is OK; bad JSON is not.
    }
  }

  // Compute next version: currentVersion + 0.1, rounded to 1 decimal.
  const current = Number(obj.currentVersion);
  const nextVer = new Prisma.Decimal((current + 0.1).toFixed(1));

  const updated = await prisma.$transaction(async (tx) => {
    // Ensure a Revision row exists for currentRevision.
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
    await tx.version.create({
      data: {
        revisionId: revision.id,
        ver: nextVer,
        createdBy: user.id,
        comment: parsedBody.comment ?? null,
      },
    });
    const updatedObject = await tx.objectEntity.update({
      where: { id: obj.id },
      data: {
        state: ObjectState.CHECKED_IN,
        currentVersion: nextVer,
        lockedById: null,
      },
    });

    // R29 / N-1 — notify the owner that their object was checked back in.
    // Skip if the owner is the actor (no self-notify).
    if (obj.ownerId !== user.id) {
      await enqueueNotification(tx, {
        userId: obj.ownerId,
        type: 'OBJECT_CHECKIN',
        title: '자료가 체크인되었습니다',
        body: `${obj.number} (v${nextVer.toString()})`,
        objectId: obj.id,
        metadata: {
          version: nextVer.toString(),
          revision: obj.currentRevision,
          actorId: user.id,
        },
      });
    }

    return updatedObject;
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'OBJECT_CHECKIN',
    objectId: obj.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      version: nextVer.toString(),
      revision: obj.currentRevision,
    },
  });

  return ok(updated);
}
