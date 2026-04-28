// Integration test — POST /api/v1/objects/{id}/attachments
//
// Two assertions:
//   1. Successful upload creates an Attachment row with virusScanStatus
//      defaulted to PENDING (R36 V-INF-3) and the scan-queue is enqueued.
//   2. INFECTED attachment blocks GET /api/v1/attachments/{id}/file via
//      `blockIfInfected` guard.

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
  scanQueueMockFactory,
  conversionQueueMockFactory,
  queueRecorder,
  loginAs,
  jsonRequest,
} from './test-helpers';

vi.mock('@/lib/auth-helpers', () => authHelpersMockFactory());
vi.mock('@/lib/prisma', () => prismaMockFactory());
vi.mock('@/lib/audit', () => auditMockFactory());
vi.mock('@/lib/scan-queue', () => scanQueueMockFactory());
vi.mock('@/lib/conversion-queue', () => conversionQueueMockFactory());

// Storage layer — we don't need a real fs, just a pass-through stub.
vi.mock('@/lib/storage', async () => {
  const fakeStorage = {
    put: vi.fn(async () => {}),
    get: vi.fn(async () => ({
      stream: (await import('node:stream')).Readable.from(Buffer.from('x')),
      size: 1,
      contentType: 'application/octet-stream',
    })),
    stat: vi.fn(async () => ({ size: 1 })),
    exists: vi.fn(async () => true),
    list: vi.fn(async () => ({ items: [] })),
    delete: vi.fn(async () => {}),
  };
  return { getStorage: () => fakeStorage };
});

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  await freshWorld();
  loginAs(null);
  queueRecorder.reset();
});

afterAll(async () => {
  await disposeTestPrisma();
});

async function seedObject(): Promise<string> {
  const prisma = getTestPrisma();
  const obj = await prisma.objectEntity.create({
    data: {
      number: 'TEST-0001',
      name: '테스트 도면',
      folderId: TEST_IDS.folderRoot,
      classId: TEST_IDS.classGen,
      ownerId: TEST_IDS.user,
      state: 'NEW',
      securityLevel: 5,
    },
    select: { id: true },
  });
  return obj.id;
}

describe('POST /api/v1/objects/{id}/attachments — virus scan integration', () => {
  it('creates Attachment with virusScanStatus=PENDING and enqueues a scan job', async () => {
    const { POST } = await import(
      '@/app/api/v1/objects/[id]/attachments/route'
    );
    loginAs('user');
    const objectId = await seedObject();

    // Build a multipart body manually.
    const fileBytes = Buffer.from('hello-test-dwg');
    const boundary = '----vitestBoundary';
    const head =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="t.dwg"\r\n` +
      `Content-Type: application/acad\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([
      Buffer.from(head, 'utf8'),
      fileBytes,
      Buffer.from(tail, 'utf8'),
    ]);
    const req = new Request(
      `http://localhost:3000/api/v1/objects/${objectId}/attachments`,
      {
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
        },
        body,
      },
    );
    const resp = await POST(req as never, { params: { id: objectId } });
    expect(resp.status).toBe(201);

    const att = await getTestPrisma().attachment.findFirst({
      where: { filename: 't.dwg' },
    });
    expect(att).not.toBeNull();
    expect(att?.virusScanStatus).toBe('PENDING');
    expect(queueRecorder.scans).toHaveLength(1);
    expect(queueRecorder.scans[0]?.attachmentId).toBe(att?.id);
  });

  it('blocks GET /file when an attachment is INFECTED', async () => {
    // Build the row directly so we can flip status.
    const prisma = getTestPrisma();
    const objectId = await seedObject();
    const rev = await prisma.revision.create({
      data: { objectId, rev: 0 },
    });
    const ver = await prisma.version.create({
      data: { revisionId: rev.id, ver: '0.0', createdBy: TEST_IDS.user },
    });
    const att = await prisma.attachment.create({
      data: {
        id: 'inf-att-1',
        versionId: ver.id,
        filename: 'evil.dwg',
        storagePath: 'inf-att-1/source.dwg',
        mimeType: 'application/acad',
        size: BigInt(10),
        isMaster: true,
        checksumSha256: 'a'.repeat(64),
        virusScanStatus: 'INFECTED',
        virusScanSig: 'Test.Trojan.X',
      },
    });

    const { GET } = await import(
      '@/app/api/v1/attachments/[id]/file/route'
    );
    loginAs('user');
    const req = jsonRequest('GET', `/api/v1/attachments/${att.id}/file`);
    const resp = await GET(req, { params: { id: att.id } });
    expect(resp.status).toBe(403);
  });
});
