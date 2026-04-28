// Pure transform-helper unit tests. Fast, isolated; no Source needed.

import { describe, expect, it } from 'vitest';
import {
  clampSecurityLevel,
  mapEmploymentType,
  mapObjectState,
  mapRole,
  normalizeFolderCode,
} from '../src/transform/helpers.js';
import { transformFolder } from '../src/transform/folder.js';
import { transformUser } from '../src/transform/user.js';
import { transformObject } from '../src/transform/object.js';

describe('mapRole', () => {
  it('maps known hints', () => {
    expect(mapRole('SUPER_ADMIN')).toBe('SUPER_ADMIN');
    expect(mapRole('슈퍼관리자')).toBe('SUPER_ADMIN');
    expect(mapRole('ADMIN')).toBe('ADMIN');
    expect(mapRole('관리자')).toBe('ADMIN');
    expect(mapRole('PARTNER')).toBe('PARTNER');
    expect(mapRole('협력업체')).toBe('PARTNER');
  });
  it('falls back to USER for unknown', () => {
    expect(mapRole('DESIGNER')).toBe('USER');
    expect(mapRole('VIEWER')).toBe('USER');
    expect(mapRole('')).toBe('USER');
  });
});

describe('mapEmploymentType', () => {
  it('returns RETIRED when not active regardless of hint', () => {
    expect(mapEmploymentType(false, 'ADMIN')).toBe('RETIRED');
  });
  it('returns PARTNER when active + role hint is partner', () => {
    expect(mapEmploymentType(true, '협력업체')).toBe('PARTNER');
  });
  it('returns ACTIVE otherwise', () => {
    expect(mapEmploymentType(true, 'DESIGNER')).toBe('ACTIVE');
  });
});

describe('mapObjectState', () => {
  it('collapses CHECKED_OUT to CHECKED_IN', () => {
    expect(mapObjectState('CHECKED_OUT')).toBe('CHECKED_IN');
  });
  it('preserves NEW / DRAFT', () => {
    expect(mapObjectState('NEW')).toBe('NEW');
    expect(mapObjectState('DRAFT')).toBe('NEW');
  });
  it('handles APPROVED variants', () => {
    expect(mapObjectState('APPROVED')).toBe('APPROVED');
    expect(mapObjectState('승인완료')).toBe('APPROVED');
  });
});

describe('normalizeFolderCode', () => {
  it('strips spaces + lowercases hex', () => {
    expect(normalizeFolderCode('Root / Project A')).toBe('ROOT_/_PROJECT_A');
  });
  it('strips disallowed punctuation', () => {
    expect(normalizeFolderCode('A&B@C')).toBe('ABC');
  });
});

describe('clampSecurityLevel', () => {
  it('clamps to [1,5]', () => {
    expect(clampSecurityLevel(0)).toBe(1);
    expect(clampSecurityLevel(99)).toBe(5);
    expect(clampSecurityLevel(3)).toBe(3);
  });
  it('returns 5 for non-finite', () => {
    expect(clampSecurityLevel(Number.NaN)).toBe(5);
  });
});

describe('transformUser', () => {
  it('resolves organization id via the map', () => {
    const map = new Map([['org-1', 'cuid-org-1']]);
    const target = transformUser(
      {
        externalId: 'u-1',
        username: 'alice',
        fullName: '앨리스',
        email: 'alice@example.com',
        organizationExternalId: 'org-1',
        roleHint: 'DESIGNER',
        active: true,
      },
      map,
    );
    expect(target.organizationId).toBe('cuid-org-1');
    expect(target.role).toBe('USER');
    expect(target.employmentType).toBe('ACTIVE');
  });

  it('leaves orgId null when source has no org', () => {
    const target = transformUser(
      {
        externalId: 'u-2',
        username: 'b',
        fullName: 'b',
        email: null,
        organizationExternalId: null,
        roleHint: 'ADMIN',
        active: true,
      },
      new Map(),
    );
    expect(target.organizationId).toBeNull();
    expect(target.role).toBe('ADMIN');
  });
});

describe('transformFolder', () => {
  it('suffixes a number on collision', () => {
    const codes = new Set<string>();
    const a = transformFolder(
      {
        externalId: 'f-1',
        name: 'A',
        pathCode: 'A',
        parentExternalId: null,
        sortOrder: 0,
      },
      new Map(),
      codes,
    );
    const b = transformFolder(
      {
        externalId: 'f-2',
        name: 'A',
        pathCode: 'A',
        parentExternalId: null,
        sortOrder: 0,
      },
      new Map(),
      codes,
    );
    expect(a.folderCode).toBe('A');
    expect(b.folderCode).toBe('A_2');
  });
});

describe('transformObject', () => {
  const baseCtx = () => ({
    folderIdMap: new Map([['f-1', 'cuid-f-1']]),
    classIdByCode: new Map([['PART', 'cuid-class-part']]),
    userIdMap: new Map([['u-1', 'cuid-u-1']]),
    seenNumbers: new Set<string>(),
    numberCollisions: new Set<string>(),
  });

  it('throws when folder mapping is missing', () => {
    expect(() =>
      transformObject(
        {
          externalId: 'd-1',
          number: 'D-001',
          name: 'X',
          description: null,
          folderExternalId: 'f-missing',
          classCode: 'PART',
          ownerExternalId: 'u-1',
          securityLevel: 3,
          stateHint: 'DRAFT',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        baseCtx(),
      ),
    ).toThrow(/folder mapping/);
  });

  it('renames second occurrence and records the collision', () => {
    const ctx = baseCtx();
    const first = transformObject(
      {
        externalId: 'd-1',
        number: 'D-001',
        name: 'A',
        description: null,
        folderExternalId: 'f-1',
        classCode: 'PART',
        ownerExternalId: 'u-1',
        securityLevel: 3,
        stateHint: 'DRAFT',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      ctx,
    );
    const second = transformObject(
      {
        externalId: 'd-2',
        number: 'D-001',
        name: 'B',
        description: null,
        folderExternalId: 'f-1',
        classCode: 'PART',
        ownerExternalId: 'u-1',
        securityLevel: 3,
        stateHint: 'DRAFT',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      ctx,
    );
    expect(first.number).toBe('D-001');
    expect(second.number).toBe('D-001-MIG2');
    expect([...ctx.numberCollisions]).toEqual(['D-001']);
  });
});
