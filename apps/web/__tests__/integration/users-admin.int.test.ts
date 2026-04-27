// Integration test — POST /api/v1/admin/users
//
// Mirrors a real admin "create user" flow:
//   1. Log in as super-admin via the test session.
//   2. POST a valid body to the route handler.
//   3. Assert 201 + a User row is in the DB with the expected role.
//   4. Negative case — non-admin caller gets 403 and no row lands.

import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import {
  freshWorld,
  ensureSchema,
  disposeTestPrisma,
  getTestPrisma,
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

describe('POST /api/v1/admin/users', () => {
  it('super-admin can create a USER and the row lands in the DB', async () => {
    const { POST } = await import('@/app/api/v1/admin/users/route');
    loginAs('super_admin');

    const req = jsonRequest('POST', '/api/v1/admin/users', {
      username: 'newbie',
      fullName: '신입',
      role: 'USER',
      securityLevel: 5,
      password: 'super-secret-1234',
    });
    const resp = await POST(req);
    const body = await readJson<{ data: { id: string; username: string } }>(
      resp,
    );

    expect(resp.status).toBe(201);
    expect(body.data.username).toBe('newbie');

    const row = await getTestPrisma().user.findUnique({
      where: { username: 'newbie' },
    });
    expect(row).not.toBeNull();
    expect(row?.role).toBe('USER');
    expect(row?.passwordHash).not.toBe('super-secret-1234');
    expect(row?.passwordHash.length ?? 0).toBeGreaterThan(20);
  });

  it('plain user gets 403 and no row is created', async () => {
    const { POST } = await import('@/app/api/v1/admin/users/route');
    loginAs('user');

    const req = jsonRequest('POST', '/api/v1/admin/users', {
      username: 'rogue',
      fullName: 'Rogue',
      role: 'USER',
      password: 'irrelevant-1234',
    });
    const resp = await POST(req);
    expect(resp.status).toBe(403);

    const row = await getTestPrisma().user.findUnique({
      where: { username: 'rogue' },
    });
    expect(row).toBeNull();
  });
});
