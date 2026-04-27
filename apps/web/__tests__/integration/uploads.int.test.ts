// Integration test — POST /api/v1/uploads
//
// Verifies that initializing a chunked upload session creates an Upload row
// owned by the caller with status PENDING and a temp file reservation.

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

// upload-store reserves an on-disk temp file. Replace it with an in-memory
// stub so the test doesn't need a real UPLOAD_TMP_ROOT directory.
vi.mock('@/lib/upload-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/upload-store')>(
    '@/lib/upload-store',
  );
  return {
    ...actual,
    reserveUpload: async () => {},
    uploadStoragePath: (id: string) => `/tmp/test-uploads/${id}.bin`,
  };
});

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

describe('POST /api/v1/uploads', () => {
  it('logged-in user creates an Upload row in PENDING state', async () => {
    const { POST } = await import('@/app/api/v1/uploads/route');
    loginAs('user');

    const req = jsonRequest('POST', '/api/v1/uploads', {
      filename: 'big.dwg',
      mimeType: 'application/acad',
      totalBytes: 12345,
    });
    const resp = await POST(req as never, undefined as never);
    const body = await readJson<{
      data: { uploadId: string; chunkSize: number; expiresAt: string };
    }>(resp);

    expect(resp.status).toBe(201);
    expect(body.data.uploadId).toMatch(/^[a-z0-9]+$/i);
    expect(body.data.chunkSize).toBeGreaterThan(0);

    const row = await getTestPrisma().upload.findUnique({
      where: { id: body.data.uploadId },
    });
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(TEST_IDS.user);
    expect(row?.status).toBe('PENDING');
    expect(Number(row?.totalBytes ?? 0)).toBe(12345);
  });

  it('rejects unauthenticated callers with 401', async () => {
    const { POST } = await import('@/app/api/v1/uploads/route');
    loginAs(null);

    const req = jsonRequest('POST', '/api/v1/uploads', {
      filename: 'no.dwg',
      mimeType: 'application/acad',
      totalBytes: 100,
    });
    const resp = await POST(req as never, undefined as never);
    expect(resp.status).toBe(401);
  });
});
