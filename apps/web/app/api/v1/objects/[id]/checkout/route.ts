// POST /api/v1/objects/:id/checkout
//
// Allowed from: NEW, CHECKED_IN, APPROVED  → CHECKED_OUT
// Side effects: lockedById = user.id
//   When transitioning from APPROVED, the caller is implicitly starting a
//   new revision; we leave currentRevision/currentVersion as-is here and let
//   the subsequent checkin bump the version.
//
// TRD §5.3.

import { NextResponse } from 'next/server';
import { ObjectState } from '@prisma/client';
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
      folderId: true,
      ownerId: true,
      securityLevel: true,
      state: true,
      lockedById: true,
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

  const t = canTransition(obj.state, 'checkout', {
    lockedById: obj.lockedById,
    userId: user.id,
  });
  if (!t.ok) {
    const code =
      t.reason === 'ALREADY_LOCKED' ? ErrorCode.E_LOCKED : ErrorCode.E_STATE_CONFLICT;
    return error(code, t.message);
  }

  const updated = await prisma.objectEntity.update({
    where: { id: obj.id },
    data: { state: ObjectState.CHECKED_OUT, lockedById: user.id },
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'OBJECT_CHECKOUT',
    objectId: obj.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { from: obj.state },
  });

  return ok(updated);
}
