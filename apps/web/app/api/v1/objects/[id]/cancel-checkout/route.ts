// POST /api/v1/objects/:id/cancel-checkout
//
// CHECKED_OUT (locked by caller) → CHECKED_IN
// Releases the self lock without producing a new version. This is distinct
// from `/release` which submits the object for approval (CHECKED_IN → IN_APPROVAL).
//
// Body: none (or `{}`)
// TRD §5.3 — see state-machine `cancelCheckout` action.

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
import { withApi } from '@/lib/api-helpers';

export const POST = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
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

  const t = canTransition(obj.state, 'cancelCheckout', {
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

  // No version/revision change — checkout never produced a Version row, so
  // cancelling simply releases the lock and reverts state to CHECKED_IN.
  const updated = await prisma.$transaction(async (tx) => {
    return tx.objectEntity.update({
      where: { id: obj.id },
      data: {
        state: ObjectState.CHECKED_IN,
        lockedById: null,
      },
    });
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'OBJECT_CANCEL_CHECKOUT',
    objectId: obj.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      from: obj.state,
      revision: obj.currentRevision,
      version: obj.currentVersion.toString(),
    },
  });

  return ok(updated);
  },
);
