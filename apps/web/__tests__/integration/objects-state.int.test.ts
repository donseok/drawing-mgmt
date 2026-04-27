// Integration test — checkout/checkin state machine
//
// Walks an Object through NEW → CHECKED_OUT → CHECKED_IN and asserts the
// state column + lockedById flips and a Version row is created on checkin.

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

// notifications.ts may try to enqueue a mail job — short-circuit with a stub.
vi.mock('@/lib/notifications', () => ({
  enqueueNotification: async () => ({ id: 'mock-notif' }),
}));

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

describe('Object state machine', () => {
  it('checkout flips state to CHECKED_OUT and sets lockedById', async () => {
    const prisma = getTestPrisma();
    const obj = await prisma.objectEntity.create({
      data: {
        number: 'ST-0001',
        name: '상태 테스트',
        folderId: TEST_IDS.folderRoot,
        classId: TEST_IDS.classGen,
        ownerId: TEST_IDS.user,
        state: 'NEW',
        securityLevel: 5,
      },
      select: { id: true },
    });

    const { POST } = await import(
      '@/app/api/v1/objects/[id]/checkout/route'
    );
    loginAs('user');
    const req = jsonRequest('POST', `/api/v1/objects/${obj.id}/checkout`);
    const resp = await POST(req, { params: { id: obj.id } });
    expect(resp.status).toBe(200);

    const after = await prisma.objectEntity.findUnique({
      where: { id: obj.id },
    });
    expect(after?.state).toBe('CHECKED_OUT');
    expect(after?.lockedById).toBe(TEST_IDS.user);
  });

  it('checkin from CHECKED_OUT bumps version, clears lock, creates Version row', async () => {
    const prisma = getTestPrisma();
    const obj = await prisma.objectEntity.create({
      data: {
        number: 'ST-0002',
        name: '체크인 테스트',
        folderId: TEST_IDS.folderRoot,
        classId: TEST_IDS.classGen,
        ownerId: TEST_IDS.user,
        state: 'CHECKED_OUT',
        lockedById: TEST_IDS.user,
        securityLevel: 5,
        currentRevision: 0,
        currentVersion: '0.0',
      },
      select: { id: true },
    });

    const { POST } = await import(
      '@/app/api/v1/objects/[id]/checkin/route'
    );
    loginAs('user');
    const req = jsonRequest('POST', `/api/v1/objects/${obj.id}/checkin`, {
      comment: 'first checkin',
    });
    const resp = await POST(req, { params: { id: obj.id } });
    const body = await readJson<{ data: { state: string } }>(resp);

    expect(resp.status).toBe(200);
    expect(body.data.state).toBe('CHECKED_IN');

    const after = await prisma.objectEntity.findUnique({
      where: { id: obj.id },
    });
    expect(after?.state).toBe('CHECKED_IN');
    expect(after?.lockedById).toBeNull();
    expect(Number(after?.currentVersion)).toBeCloseTo(0.1, 5);

    const versions = await prisma.version.findMany({
      where: { revision: { objectId: obj.id } },
    });
    expect(versions.length).toBeGreaterThanOrEqual(1);
    const matched = versions.find((v) => Number(v.ver) === 0.1);
    expect(matched).toBeDefined();
    expect(matched?.comment).toBe('first checkin');
  });
});
