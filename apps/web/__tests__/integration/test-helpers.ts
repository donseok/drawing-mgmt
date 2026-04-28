// Integration test helpers — Route Handler direct call + auth mocking.
//
// Why direct call instead of `next start` + supertest:
//   Route Handlers are plain async fns of `(Request, ctx) => Promise<Response>`.
//   We can import them and call them directly, which is ~1000x faster than
//   spinning up a Next server, gives us full stack traces, and lets us mock
//   `auth()` by replacing the module export with vi.mock.
//
// Auth mocking strategy:
//   The route handlers call `requireUser()` (lib/auth-helpers) which reads
//   the cookie via Auth.js `auth()`. We can't easily inject a cookie from
//   a hand-rolled Request, so we override the prisma singleton's
//   `lib/auth-helpers` export via `vi.mock('@/lib/auth-helpers', ...)`.
//
//   Tests call `loginAs(role)` to swap in a known user; the helper module
//   keeps the active actor in a closure so multiple route invocations in
//   the same test see the same identity.

import { vi } from 'vitest';
import { TEST_IDS, getTestPrisma } from './setup';

// Mutable holder for the currently "logged-in" user. Tests flip this via
// `loginAs(...)` between cases.
let activeUserId: string | null = null;

/**
 * Switch the integration test "session" to a known user. Pass null to
 * simulate an unauthenticated caller.
 */
export function loginAs(
  role: 'super_admin' | 'admin' | 'user' | null,
): void {
  switch (role) {
    case 'super_admin':
      activeUserId = TEST_IDS.superAdmin;
      break;
    case 'admin':
      activeUserId = TEST_IDS.admin;
      break;
    case 'user':
      activeUserId = TEST_IDS.user;
      break;
    case null:
      activeUserId = null;
      break;
  }
}

export function currentTestUserId(): string | null {
  return activeUserId;
}

/**
 * vi.mock factory for `@/lib/auth-helpers`. Tests import this and pass it
 * to vi.mock at the top of each file. We can't put `vi.mock` here directly
 * because vi.mock is hoisted to the top of the *test* file.
 *
 * Usage in a test file:
 *
 *   import { authHelpersMockFactory } from './test-helpers';
 *   vi.mock('@/lib/auth-helpers', () => authHelpersMockFactory());
 */
export function authHelpersMockFactory() {
  return {
    getCurrentUser: async () => {
      if (!activeUserId) return null;
      const prisma = getTestPrisma();
      const user = await prisma.user.findUnique({
        where: { id: activeUserId },
      });
      if (!user || user.deletedAt) return null;
      const { passwordHash: _omit, ...rest } = user;
      return rest;
    },
    requireUser: async () => {
      if (!activeUserId) {
        const { error, ErrorCode } = await import('@/lib/api-response');
        throw error(ErrorCode.E_AUTH);
      }
      const prisma = getTestPrisma();
      const user = await prisma.user.findUnique({
        where: { id: activeUserId },
      });
      if (!user || user.deletedAt) {
        const { error, ErrorCode } = await import('@/lib/api-response');
        throw error(ErrorCode.E_AUTH);
      }
      const { passwordHash: _omit, ...rest } = user;
      return rest;
    },
    getSessionClaims: async () => {
      if (!activeUserId) return null;
      const prisma = getTestPrisma();
      const user = await prisma.user.findUnique({
        where: { id: activeUserId },
        select: {
          id: true,
          username: true,
          fullName: true,
          role: true,
          securityLevel: true,
          organizationId: true,
        },
      });
      return user as unknown;
    },
  };
}

/**
 * Mock factory for `@/lib/prisma`. Routes that import `prisma` from this
 * module need to see the test client. We can't just re-export the singleton
 * here because vi.mock is module-scoped — instead we lazily resolve via
 * `getTestPrisma()` inside a Proxy so the test DB connection is real.
 */
export function prismaMockFactory() {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      const client = getTestPrisma() as unknown as Record<string, unknown>;
      return client[prop as string];
    },
  };
  const proxy = new Proxy({}, handler);
  return { prisma: proxy, default: proxy };
}

/**
 * Mock factory for `@/lib/audit`. Route handlers fire ActivityLog inserts;
 * tests don't need to assert audit rows but they also don't want the
 * inserts to fail because audit reads from the dev prisma. We swap the
 * module so logActivity writes through the test prisma.
 */
export function auditMockFactory() {
  return {
    logActivity: async (input: {
      userId: string;
      action: string;
      objectId?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      metadata?: unknown;
    }) => {
      try {
        const prisma = getTestPrisma();
        await prisma.activityLog.create({
          data: {
            userId: input.userId,
            action: input.action,
            objectId: input.objectId ?? null,
            ipAddress: input.ipAddress ?? null,
            userAgent: input.userAgent ?? null,
            metadata: (input.metadata as never) ?? null,
          },
        });
      } catch {
        /* swallow */
      }
    },
    extractRequestMeta: (req: Request) => ({
      ipAddress:
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    }),
  };
}

/**
 * Mock the BullMQ-backed queues so route handlers don't need a real Redis.
 * Each queue helper returns `{ ok: true, jobId: 'mock-...' }` and records
 * the call so tests can assert on it via `enqueuedScans` / `enqueuedConversions`.
 */
export const queueRecorder = {
  scans: [] as Array<{ attachmentId: string; storagePath: string }>,
  conversions: [] as Array<{ attachmentId: string; storagePath: string }>,
  prints: [] as Array<{ attachmentId: string }>,
  mails: [] as Array<{ to: string; subject: string }>,
  reset() {
    this.scans = [];
    this.conversions = [];
    this.prints = [];
    this.mails = [];
  },
};

export function scanQueueMockFactory() {
  return {
    enqueueVirusScan: async (input: {
      attachmentId: string;
      storagePath: string;
      filename: string;
      size?: number;
    }) => {
      queueRecorder.scans.push({
        attachmentId: input.attachmentId,
        storagePath: input.storagePath,
      });
      return { ok: true, jobId: `mock-scan-${input.attachmentId}` };
    },
    requeueVirusScan: async (input: { attachmentId: string; storagePath: string; filename: string; size?: number }) => {
      queueRecorder.scans.push({
        attachmentId: input.attachmentId,
        storagePath: input.storagePath,
      });
      return { ok: true, jobId: `mock-scan-${input.attachmentId}` };
    },
    getScanQueue: () => ({}),
  };
}

export function conversionQueueMockFactory() {
  return {
    enqueueConversion: async (input: {
      attachmentId: string;
      storagePath: string;
      filename: string;
      mimeType: string;
    }) => {
      queueRecorder.conversions.push({
        attachmentId: input.attachmentId,
        storagePath: input.storagePath,
      });
      return { ok: true, jobId: `mock-conv-${input.attachmentId}` };
    },
    enqueuePrint: async (input: { attachmentId: string }) => {
      queueRecorder.prints.push({ attachmentId: input.attachmentId });
      return {
        ok: true,
        status: 'QUEUED' as const,
        jobId: `mock-print-${input.attachmentId}`,
      };
    },
    requeueConversion: async () => {},
    getConversionQueue: () => ({}),
    getPrintQueue: () => ({}),
    PRINT_QUEUE_NAME: 'pdf-print',
    CONVERSION_JOB_OPTIONS: {},
  };
}

/**
 * Build a JSON Request for a Route Handler. Adds a same-origin Origin
 * header so `withApi`'s CSRF guard accepts the call.
 *
 * Returns a `NextRequest`-typed object so tests can pass the result straight
 * into withApi-wrapped handlers without a cast. The runtime shape is a plain
 * `Request` — Next.js's runtime tolerates this because the wrapper only
 * touches `req.headers`, `req.method`, `req.url`, and `req.json()`.
 */
import type { NextRequest } from 'next/server';

export function jsonRequest(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  init?: { headers?: Record<string, string> },
): NextRequest {
  const fullUrl = url.startsWith('http')
    ? url
    : `http://localhost:3000${url}`;
  const origin = 'http://localhost:3000';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin,
    host: 'localhost:3000',
    ...(init?.headers ?? {}),
  };
  return new Request(fullUrl, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest;
}

/**
 * Read a Response body as JSON. Throws a helpful error when the body
 * isn't JSON (most often a 4xx HTML page from a stack trace in dev).
 */
export async function readJson<T = unknown>(resp: Response): Promise<T> {
  const text = await resp.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(
      `Expected JSON response but got status=${resp.status} body=${text.slice(0, 200)}`,
    );
  }
}
