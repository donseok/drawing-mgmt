// POST /api/v1/admin/storage/test
//
// R34 V-INF-1 — connection test for the configured storage driver. Performs
// a `list('', { limit: 1 })` round-trip. For LocalStorage that's a directory
// stat; for S3/MinIO it's a `ListObjectsV2` against the bucket which doubles
// as an auth + reachability probe.
//
// Wrapped with `withApi({ rateLimit: 'api' })` because admin "press to test"
// buttons are easy to spam — and because the wrapper enforces the SEC-1
// same-origin assertion.
//
// Response:
//   200 { driver, ok: true, latencyMs, sampleSize }
//   500 { error: { code: 'E_INTERNAL', message, details: { errorMessage } } }
//
// Auth: SUPER_ADMIN or ADMIN.

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { getStorage, getStorageInfo } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi({ rateLimit: 'api' }, async () => {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
    return error(ErrorCode.E_FORBIDDEN);
  }

  const info = getStorageInfo();
  const storage = getStorage();

  const start = Date.now();
  try {
    const result = await storage.list('', { limit: 1 });
    const latencyMs = Date.now() - start;
    return ok({
      driver: info.driver,
      ok: true,
      latencyMs,
      sampleSize: result.items.length,
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return error(
      ErrorCode.E_INTERNAL,
      `Storage 연결 실패 (${info.driver}): ${message}`,
      undefined,
      { driver: info.driver, latencyMs, errorMessage: message },
    );
  }
});
