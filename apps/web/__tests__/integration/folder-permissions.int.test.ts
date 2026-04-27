// Integration test — PUT /api/v1/folders/{id}/permissions
//
// Verifies that the full-replace endpoint inserts the requested rows in a
// transaction and that the resulting set matches what the FE matrix sent.

import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import {
  freshWorld,
  ensureSchema,
  disposeTestPrisma,
  getTestPrisma,
  TEST_IDS,
} from './setup';
import {
  authHelpersMockFactory,
  prismaMockFactory,
  auditMockFactory,
  loginAs,
  jsonRequest,
  readJson,
} from './test-helpers';

vi.mock('@/lib/auth-helpers', () => authHelpersMockFactory());
vi.mock('@/lib/prisma', () => prismaMockFactory());
vi.mock('@/lib/audit', () => auditMockFactory());

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  await freshWorld();
  loginAs(null);
});

afterAll(async () => {
  await disposeTestPrisma();
});

describe('PUT /api/v1/folders/{id}/permissions', () => {
  it('admin replaces the permission set in one shot', async () => {
    const { PUT } = await import(
      '@/app/api/v1/folders/[id]/permissions/route'
    );
    loginAs('admin');

    const body = {
      rows: [
        {
          principalType: 'USER' as const,
          principalId: TEST_IDS.user,
          viewFolder: true,
          editFolder: false,
          viewObject: true,
          editObject: false,
          deleteObject: false,
          approveObject: false,
          download: true,
          print: false,
        },
        {
          principalType: 'ORG' as const,
          principalId: TEST_IDS.org,
          viewFolder: true,
          editFolder: true,
          viewObject: true,
          editObject: true,
          deleteObject: true,
          approveObject: true,
          download: true,
          print: true,
        },
      ],
    };
    const req = jsonRequest(
      'PUT',
      `/api/v1/folders/${TEST_IDS.folderRoot}/permissions`,
      body,
    );
    const resp = await PUT(req as never, {
      params: { id: TEST_IDS.folderRoot },
    } as never);
    const json = await readJson<{ data: unknown }>(resp);

    expect(resp.status).toBe(200);
    expect(json.data).toBeDefined();

    const rows = await getTestPrisma().folderPermission.findMany({
      where: { folderId: TEST_IDS.folderRoot },
      orderBy: { principalType: 'asc' },
    });
    expect(rows).toHaveLength(2);
    const orgRow = rows.find((r) => r.principalType === 'ORG');
    expect(orgRow?.editFolder).toBe(true);
    expect(orgRow?.print).toBe(true);
    const userRow = rows.find((r) => r.principalType === 'USER');
    expect(userRow?.viewFolder).toBe(true);
    expect(userRow?.editFolder).toBe(false);
  });

  it('non-admin caller is rejected', async () => {
    const { PUT } = await import(
      '@/app/api/v1/folders/[id]/permissions/route'
    );
    loginAs('user');

    const req = jsonRequest(
      'PUT',
      `/api/v1/folders/${TEST_IDS.folderRoot}/permissions`,
      { rows: [] },
    );
    const resp = await PUT(req as never, {
      params: { id: TEST_IDS.folderRoot },
    } as never);
    expect(resp.status).toBe(403);
  });
});
