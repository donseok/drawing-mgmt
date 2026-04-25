/**
 * Permission evaluation per TRD §5.2.
 *
 *   canAccess(user, object, action) =
 *     1. user.role === SUPER_ADMIN          → ALLOW
 *     2. object.ownerId === user.id          → ALLOW (등록자 우선)
 *     3. object.securityLevel < user.level   → DENY
 *        (lower number == higher clearance, 1 is highest, 5 is lowest)
 *     4. folderPermission(user|user.org|user.groups, object.folderId, action) === true
 *                                             → ALLOW
 *     5. ELSE                                 → DENY
 *
 * Pure function — no DB access. Caller must pre-load the relevant
 * FolderPermission rows for the object's folderId (and ideally any ancestor
 * folders if the caller chooses to inherit; current implementation evaluates
 * exactly the supplied permission set).
 */
import type { PermissionAction, RoleName } from './types';

export type PermissionPrincipalType = 'USER' | 'ORG' | 'GROUP';

/** Subject performing the action. */
export interface PermissionUser {
  id: string;
  role: RoleName;
  /** 1 = highest clearance, 5 = lowest. */
  securityLevel: number;
  organizationId?: string | null;
  /** All groups this user is a member of (Group.id list). */
  groupIds?: readonly string[];
}

/** Object being acted on. */
export interface PermissionObject {
  id: string;
  folderId: string;
  ownerId: string;
  /** 1 = strictest, 5 = most open. */
  securityLevel: number;
}

/** Subset of a FolderPermission row used for evaluation. */
export interface PermissionRow {
  folderId: string;
  principalType: PermissionPrincipalType;
  principalId: string;
  viewFolder: boolean;
  editFolder: boolean;
  viewObject: boolean;
  editObject: boolean;
  deleteObject: boolean;
  approveObject: boolean;
  download: boolean;
  print: boolean;
}

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Action enum (re-exported as both type and runtime value).
 * Names mirror the bit columns + folder-only actions from the TRD.
 */
export const PERMISSION_ACTIONS = {
  VIEW_FOLDER: 'VIEW_FOLDER',
  EDIT_FOLDER: 'EDIT_FOLDER',
  VIEW: 'VIEW',
  EDIT: 'EDIT',
  DELETE: 'DELETE',
  APPROVE: 'APPROVE',
  DOWNLOAD: 'DOWNLOAD',
  PRINT: 'PRINT',
} as const satisfies Record<PermissionAction, PermissionAction>;

export type Action = PermissionAction;

/** Subset of PermissionRow keys that are boolean grant bits. */
type PermissionBit =
  | 'viewFolder'
  | 'editFolder'
  | 'viewObject'
  | 'editObject'
  | 'deleteObject'
  | 'approveObject'
  | 'download'
  | 'print';

/**
 * Map an action onto the column of FolderPermission that grants it.
 * Folder-only actions (VIEW_FOLDER / EDIT_FOLDER) need not pass through the
 * object-level securityLevel check — they apply to the folder itself.
 */
const ACTION_TO_BIT: Readonly<Record<PermissionAction, PermissionBit>> = {
  VIEW_FOLDER: 'viewFolder',
  EDIT_FOLDER: 'editFolder',
  VIEW: 'viewObject',
  EDIT: 'editObject',
  DELETE: 'deleteObject',
  APPROVE: 'approveObject',
  DOWNLOAD: 'download',
  PRINT: 'print',
};

const FOLDER_ONLY_ACTIONS: ReadonlySet<PermissionAction> = new Set([
  'VIEW_FOLDER',
  'EDIT_FOLDER',
]);

/**
 * Determine whether a single FolderPermission row matches the calling user.
 */
function rowMatchesUser(row: PermissionRow, user: PermissionUser): boolean {
  switch (row.principalType) {
    case 'USER':
      return row.principalId === user.id;
    case 'ORG':
      return user.organizationId != null && row.principalId === user.organizationId;
    case 'GROUP':
      return (user.groupIds ?? []).includes(row.principalId);
    default:
      return false;
  }
}

/**
 * Evaluate access. `folderPermissions` should already be filtered to the
 * object's folder (ancestor inheritance, if any, is the caller's responsibility).
 */
export function canAccess(
  user: PermissionUser,
  object: PermissionObject,
  folderPermissions: readonly PermissionRow[],
  action: PermissionAction,
): AccessDecision {
  // 1. SUPER_ADMIN bypass — total access.
  if (user.role === 'SUPER_ADMIN') {
    return { allowed: true, reason: 'SUPER_ADMIN' };
  }

  // 2. Owner bypass — the original registrant always retains access to
  //    their own object regardless of clearance level.
  if (object.ownerId === user.id) {
    return { allowed: true, reason: 'OWNER' };
  }

  // 3. Security level: object.securityLevel < user.securityLevel means the
  //    object is more restricted than the user is cleared for. Folder-only
  //    actions skip this — they describe the folder, not its contents.
  if (
    !FOLDER_ONLY_ACTIONS.has(action) &&
    object.securityLevel < user.securityLevel
  ) {
    return {
      allowed: false,
      reason: `보안등급 부족 (필요: ≤${object.securityLevel}, 보유: ${user.securityLevel})`,
    };
  }

  // 4. Folder permission match on the relevant bit.
  const bit = ACTION_TO_BIT[action];
  const matched = folderPermissions.find(
    (p) =>
      p.folderId === object.folderId &&
      rowMatchesUser(p, user) &&
      p[bit] === true,
  );

  if (matched) {
    return { allowed: true, reason: `FOLDER_PERMISSION:${matched.principalType}` };
  }

  return { allowed: false, reason: '폴더 권한 없음' };
}
