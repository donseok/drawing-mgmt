// Server-side permission helpers — wraps the pure `canAccess` from
// `@drawing-mgmt/shared/permissions` with Prisma-aware loaders.
//
// These helpers are NOT a re-implementation. `canAccess` stays pure and
// testable; we just centralize the DB I/O patterns so each route handler
// doesn't repeat the same query.

import { prisma } from '@/lib/prisma';
import {
  canAccess,
  type AccessDecision,
  type PermissionUser,
  type PermissionObject,
  type PermissionRow,
} from '@drawing-mgmt/shared/permissions';
import type { PermissionAction } from '@drawing-mgmt/shared/types';
import type { User } from '@prisma/client';

/**
 * Build the PermissionUser shape from a full Prisma User. Loads group
 * memberships if not provided.
 */
export async function toPermissionUser(user: User): Promise<PermissionUser> {
  const memberships = await prisma.userGroup.findMany({
    where: { userId: user.id },
    select: { groupId: true },
  });
  return {
    id: user.id,
    role: user.role,
    securityLevel: user.securityLevel,
    organizationId: user.organizationId,
    groupIds: memberships.map((m) => m.groupId),
  };
}

/**
 * Load all FolderPermission rows for the given folder ids. Caller normally
 * passes a single folderId; multi-folder is supported for tree filtering.
 */
export async function loadFolderPermissions(
  folderIds: readonly string[],
): Promise<PermissionRow[]> {
  if (folderIds.length === 0) return [];
  const rows = await prisma.folderPermission.findMany({
    where: { folderId: { in: [...folderIds] } },
  });
  return rows.map((r) => ({
    folderId: r.folderId,
    principalType: r.principalType as PermissionRow['principalType'],
    principalId: r.principalId,
    viewFolder: r.viewFolder,
    editFolder: r.editFolder,
    viewObject: r.viewObject,
    editObject: r.editObject,
    deleteObject: r.deleteObject,
    approveObject: r.approveObject,
    download: r.download,
    print: r.print,
  }));
}

/**
 * Convenience: evaluate a single action against a single object after
 * loading the relevant folder permissions.
 */
export async function checkObjectAccess(args: {
  user: User;
  object: PermissionObject;
  action: PermissionAction;
}): Promise<AccessDecision> {
  const [pUser, perms] = await Promise.all([
    toPermissionUser(args.user),
    loadFolderPermissions([args.object.folderId]),
  ]);
  return canAccess(pUser, args.object, perms, args.action);
}

/**
 * Filter a list of folders to only those visible to the user (VIEW_FOLDER).
 * Returns the set of folder ids that are accessible.
 *
 * Note: folder-level visibility is independent of object securityLevel,
 * so we evaluate VIEW_FOLDER directly. SUPER_ADMIN sees everything.
 */
export async function filterVisibleFolders(args: {
  user: User;
  folderIds: readonly string[];
}): Promise<Set<string>> {
  if (args.user.role === 'SUPER_ADMIN') return new Set(args.folderIds);

  const [pUser, perms] = await Promise.all([
    toPermissionUser(args.user),
    loadFolderPermissions(args.folderIds),
  ]);

  const visible = new Set<string>();
  for (const fid of args.folderIds) {
    // Synthetic object — folder-only action skips securityLevel check inside canAccess.
    const decision = canAccess(
      pUser,
      { id: '', folderId: fid, ownerId: '', securityLevel: 5 },
      perms,
      'VIEW_FOLDER',
    );
    if (decision.allowed) visible.add(fid);
  }
  return visible;
}

export { canAccess };
