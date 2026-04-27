import { describe, it, expect } from 'vitest';

import {
  canAccess,
  type PermissionObject,
  type PermissionRow,
  type PermissionUser,
} from '@drawing-mgmt/shared/permissions';

// Test fixtures — kept minimal so each test reads as a single fact.
const user = (overrides: Partial<PermissionUser> = {}): PermissionUser => ({
  id: 'u-alice',
  role: 'USER',
  securityLevel: 3,
  organizationId: 'org-1',
  groupIds: ['g-eng'],
  ...overrides,
});

const obj = (overrides: Partial<PermissionObject> = {}): PermissionObject => ({
  id: 'o-1',
  folderId: 'f-1',
  ownerId: 'u-other',
  securityLevel: 3,
  ...overrides,
});

const row = (overrides: Partial<PermissionRow> = {}): PermissionRow => ({
  folderId: 'f-1',
  principalType: 'USER',
  principalId: 'u-alice',
  viewFolder: false,
  editFolder: false,
  viewObject: false,
  editObject: false,
  deleteObject: false,
  approveObject: false,
  download: false,
  print: false,
  ...overrides,
});

describe('canAccess', () => {
  it('SUPER_ADMIN bypasses all checks', () => {
    const decision = canAccess(
      user({ role: 'SUPER_ADMIN', securityLevel: 5 }),
      obj({ securityLevel: 1 }),
      [],
      'DELETE',
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('SUPER_ADMIN');
  });

  it('owner bypass works even when securityLevel is too high', () => {
    const decision = canAccess(
      user({ id: 'u-owner', securityLevel: 5 }),
      obj({ ownerId: 'u-owner', securityLevel: 1 }),
      [],
      'EDIT',
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('OWNER');
  });

  it('denies when object securityLevel is stricter than user clearance', () => {
    const decision = canAccess(
      user({ securityLevel: 3 }),
      obj({ securityLevel: 1 }),
      [row({ viewObject: true })],
      'VIEW',
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('보안등급');
  });

  it('VIEW allowed by USER-principal folder permission row', () => {
    const decision = canAccess(
      user(),
      obj(),
      [row({ viewObject: true })],
      'VIEW',
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('FOLDER_PERMISSION:USER');
  });

  it('EDIT denied when only VIEW bit is granted', () => {
    const decision = canAccess(
      user(),
      obj(),
      [row({ viewObject: true, editObject: false })],
      'EDIT',
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('폴더 권한 없음');
  });

  it('DELETE allowed via ORG-principal row matching user organizationId', () => {
    const decision = canAccess(
      user({ organizationId: 'org-1' }),
      obj(),
      [
        row({
          principalType: 'ORG',
          principalId: 'org-1',
          deleteObject: true,
        }),
      ],
      'DELETE',
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('FOLDER_PERMISSION:ORG');
  });

  it('APPROVE allowed via GROUP-principal row matching user groupIds', () => {
    const decision = canAccess(
      user({ groupIds: ['g-approvers'] }),
      obj(),
      [
        row({
          principalType: 'GROUP',
          principalId: 'g-approvers',
          approveObject: true,
        }),
      ],
      'APPROVE',
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('FOLDER_PERMISSION:GROUP');
  });

  it('GROUP row does not match when user is not in that group', () => {
    const decision = canAccess(
      user({ groupIds: ['g-other'] }),
      obj(),
      [
        row({
          principalType: 'GROUP',
          principalId: 'g-approvers',
          approveObject: true,
        }),
      ],
      'APPROVE',
    );
    expect(decision.allowed).toBe(false);
  });

  it('DOWNLOAD bit gated on its own column (not VIEW/EDIT)', () => {
    const grantOnlyView = canAccess(
      user(),
      obj(),
      [row({ viewObject: true, editObject: true })],
      'DOWNLOAD',
    );
    expect(grantOnlyView.allowed).toBe(false);

    const grantDownload = canAccess(
      user(),
      obj(),
      [row({ download: true })],
      'DOWNLOAD',
    );
    expect(grantDownload.allowed).toBe(true);
  });

  it('PRINT bit independent of DOWNLOAD bit', () => {
    const decision = canAccess(
      user(),
      obj(),
      [row({ download: true, print: false })],
      'PRINT',
    );
    expect(decision.allowed).toBe(false);
  });

  it('VIEW_FOLDER skips object securityLevel check', () => {
    // Folder-only action: object's securityLevel should not block access even
    // when stricter than the user's clearance, because the action describes
    // the folder shell rather than its contents.
    const decision = canAccess(
      user({ securityLevel: 3 }),
      obj({ securityLevel: 1 }),
      [row({ viewFolder: true })],
      'VIEW_FOLDER',
    );
    expect(decision.allowed).toBe(true);
  });

  it('returns denial when folderPermissions list is empty and not owner/admin', () => {
    const decision = canAccess(user(), obj(), [], 'VIEW');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('폴더 권한 없음');
  });
});
