// GET /api/v1/admin/storage/info
//
// R34 V-INF-1 — surface the active storage driver + sample stats so the
// `/admin/storage` page can show what backend is in use.
//
// Response:
//   {
//     driver: 'local' | 's3',
//     bucket?: string,
//     endpoint?: string,
//     region?: string,
//     forcePathStyle?: boolean,
//     rootPath?: string,
//     stats: {
//       sampledObjects: number,   // up to `limit`
//       sampledBytes: string,     // BigInt-as-string
//       truncated: boolean,       // true if more pages exist
//     }
//   }
//
// Auth: SUPER_ADMIN or ADMIN.
//
// Why "sampled" rather than "total":
//   - For large stores walking every key is expensive (S3 List is paginated
//     with hard caps; LocalStorage scans recursively). The admin UI just
//     needs a sanity check, not an exact total.
//   - Caller can pass `?limit=N` (capped at 5000) to widen the sample.

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { getStorage, getStorageInfo } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_SAMPLE = 1000;
const MAX_SAMPLE = 5000;

export async function GET(req: Request): Promise<NextResponse> {
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

  const url = new URL(req.url);
  const limitRaw = Number.parseInt(
    url.searchParams.get('limit') ?? `${DEFAULT_SAMPLE}`,
    10,
  );
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(limitRaw, MAX_SAMPLE))
    : DEFAULT_SAMPLE;

  const info = getStorageInfo();
  const storage = getStorage();

  let sampledObjects = 0;
  let sampledBytes = 0n;
  let truncated = false;
  let listError: string | undefined;

  try {
    const out = await storage.list('', { limit });
    sampledObjects = out.items.length;
    for (const it of out.items) sampledBytes += BigInt(it.size);
    truncated = Boolean(out.nextCursor);
  } catch (err) {
    // Don't 500 the admin info page just because the bucket is unreachable.
    // The /test endpoint surfaces the actual error.
    listError = err instanceof Error ? err.message : String(err);
  }

  return ok({
    driver: info.driver,
    ...(info.driver === 's3'
      ? {
          bucket: info.bucket,
          endpoint: info.endpoint,
          region: info.region,
          forcePathStyle: info.forcePathStyle ?? false,
        }
      : {
          rootPath: info.rootPath,
        }),
    stats: {
      sampledObjects,
      sampledBytes: sampledBytes.toString(),
      truncated,
      ...(listError ? { error: listError } : {}),
    },
  });
}
