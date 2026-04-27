/**
 * GET /api/v1/attachments/[id]/thumbnail
 *
 * R29 V-INF-6 — auth-gated PNG thumbnail produced by the conversion worker.
 *
 * Resolution order:
 *   1. Most recent DONE `ConversionJob.thumbnailPath`. R34+ workers write
 *      a storage key (e.g. `<attachmentId>/thumbnail.png`); pre-R34 rows
 *      may still hold an absolute filesystem path. We auto-detect: a value
 *      starting with `/` is treated as a legacy absolute path; otherwise
 *      it goes through `storage.get()`.
 *   2. Fall back to the canonical key `<attachmentId>/thumbnail.png` so we
 *      don't break for jobs that ran before the column existed.
 *   3. Else a placeholder SVG (200) — keeps the search grid `<img>` from
 *      showing broken-image icons. Callers that want a hard 404 (e.g. an
 *      admin "is conversion done?" probe) can pass `?strict=1`.
 *
 * Auth + permission:
 *   - 401 if no session.
 *   - 403 unless the user has VIEW_FOLDER on the attachment's folder. ADMIN
 *     and SUPER_ADMIN bypass the per-folder check.
 *
 * Cache:
 *   - 24h `private, max-age=86400`. Thumbnails are immutable for a given
 *     ConversionJob row; if the worker re-runs (admin retry), a NEW job row
 *     is created so re-issued URLs naturally bypass the user's cache.
 *
 * R34 V-INF-1 — fs.* swapped for `getStorage()` with a legacy fallback for
 * absolute paths still recorded in the DB. Response shape unchanged.
 */

import { NextResponse } from 'next/server';
import { promises as fs, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  toPermissionUser,
  loadFolderPermissions,
} from '@/lib/permissions';
import { error, ErrorCode } from '@/lib/api-response';
import { getStorage } from '@/lib/storage';
import { StorageNotFoundError } from '@drawing-mgmt/shared/storage';

export const runtime = 'nodejs';

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

interface AttachmentLookup {
  id: string;
  folderId: string;
  ownerId: string;
  securityLevel: number;
}

/**
 * Load the attachment + walk Version → Revision → ObjectEntity to surface
 * the folderId/ownerId/securityLevel needed for `canAccess(VIEW_FOLDER)`.
 * Returns null if the attachment doesn't exist.
 */
async function loadAttachment(id: string): Promise<AttachmentLookup | null> {
  const att = await prisma.attachment.findUnique({
    where: { id },
    select: {
      version: {
        select: {
          revision: {
            select: {
              object: {
                select: {
                  id: true,
                  folderId: true,
                  ownerId: true,
                  securityLevel: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const obj = att?.version?.revision?.object ?? null;
  if (!obj) return null;
  return {
    id: obj.id,
    folderId: obj.folderId,
    ownerId: obj.ownerId,
    securityLevel: obj.securityLevel,
  };
}

interface ResolvedThumbnail {
  /** Either a storage key (relative) or an absolute filesystem path. */
  ref: string;
  kind: 'storage' | 'legacy-fs';
}

/**
 * Resolve the thumbnail file for an attachment.
 *
 * R34 transition rules:
 *   - thumbnailPath that starts with `/` → legacy absolute fs path. Open
 *     directly via createReadStream + fs.stat (matches pre-R34 behavior).
 *   - otherwise → storage key. Routes via getStorage() so MinIO/S3 works.
 *
 * Returns null when no thumbnail can be served.
 */
async function resolveThumbnail(
  attachmentId: string,
): Promise<ResolvedThumbnail | null> {
  const job = await prisma.conversionJob.findFirst({
    where: { attachmentId, status: 'DONE', thumbnailPath: { not: null } },
    orderBy: { finishedAt: 'desc' },
    select: { thumbnailPath: true },
  });

  // 1) Persisted column — preferred.
  if (job?.thumbnailPath) {
    const recorded = job.thumbnailPath;
    if (recorded.startsWith('/')) {
      // Legacy absolute fs path. Confirm it exists before returning.
      if (await legacyExists(recorded)) {
        return { ref: recorded, kind: 'legacy-fs' };
      }
    } else if (await getStorage().exists(recorded)) {
      return { ref: recorded, kind: 'storage' };
    }
  }

  // 2) Canonical storage key fallback. Allow only attachment ids that look
  //    safe (the get/list code asserts again, but cheap to short-circuit).
  if (!/^[A-Za-z0-9_\-]+$/.test(attachmentId)) return null;
  const fallback = `${attachmentId}/thumbnail.png`;
  if (await getStorage().exists(fallback)) {
    return { ref: fallback, kind: 'storage' };
  }
  return null;
}

async function legacyExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function placeholderSvg(id: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" fill="#f3f4f6"/>
  <rect x="0.5" y="0.5" width="255" height="255" fill="none" stroke="#d1d5db"/>
  <g fill="#6b7280" font-family="system-ui, sans-serif" text-anchor="middle">
    <text x="128" y="120" font-size="14">미리보기 없음</text>
    <text x="128" y="142" font-size="11" font-family="ui-monospace, monospace">${id.slice(0, 16)}</text>
  </g>
</svg>`;
}

interface ThumbnailBody {
  stream: NodeJS.ReadableStream;
  size: number;
}

async function openThumbnail(
  resolved: ResolvedThumbnail,
): Promise<ThumbnailBody | null> {
  if (resolved.kind === 'legacy-fs') {
    try {
      const stat = await fs.stat(resolved.ref);
      return { stream: createReadStream(resolved.ref), size: stat.size };
    } catch {
      return null;
    }
  }
  try {
    const got = await getStorage().get(resolved.ref);
    return { stream: got.stream, size: got.size };
  } catch (err) {
    if (err instanceof StorageNotFoundError) return null;
    throw err;
  }
}

export async function GET(
  req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  // 1) Auth.
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  // 2) Lookup + permission.
  const att = await loadAttachment(ctx.params.id);
  if (!att) return error(ErrorCode.E_NOT_FOUND);

  if (!isAdmin(user.role)) {
    const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fullUser) return error(ErrorCode.E_AUTH);
    const [pUser, perms] = await Promise.all([
      toPermissionUser(fullUser),
      loadFolderPermissions([att.folderId]),
    ]);
    const decision = canAccess(pUser, att, perms, 'VIEW_FOLDER');
    if (!decision.allowed) return error(ErrorCode.E_FORBIDDEN, decision.reason);
  }

  // 3) Resolve the file. Default returns a placeholder SVG so existing
  // `<img>` tags don't render broken icons. Callers that need a 404 (e.g.
  // admin probes / unit tests) can pass `?strict=1`.
  const url = new URL(req.url);
  const strict = url.searchParams.get('strict') === '1';

  const resolved = await resolveThumbnail(ctx.params.id);
  const body = resolved ? await openThumbnail(resolved) : null;
  if (!body) {
    if (strict) {
      return new NextResponse('Not Found', { status: 404 });
    }
    return new NextResponse(placeholderSvg(ctx.params.id), {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'private, max-age=60',
      },
    });
  }

  // 4) Stream — keeps memory flat regardless of thumbnail size.
  const webStream = Readable.toWeb(
    body.stream as InstanceType<typeof Readable>,
  ) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(body.size),
      'Cache-Control': 'private, max-age=86400',
    },
  });
}

export async function HEAD(
  _req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  const att = await loadAttachment(ctx.params.id);
  if (!att) return new NextResponse(null, { status: 404 });
  if (!isAdmin(user.role)) {
    const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fullUser) return new NextResponse(null, { status: 401 });
    const [pUser, perms] = await Promise.all([
      toPermissionUser(fullUser),
      loadFolderPermissions([att.folderId]),
    ]);
    const decision = canAccess(pUser, att, perms, 'VIEW_FOLDER');
    if (!decision.allowed) return new NextResponse(null, { status: 403 });
  }
  const resolved = await resolveThumbnail(ctx.params.id);
  if (!resolved) return new NextResponse(null, { status: 404 });

  if (resolved.kind === 'legacy-fs') {
    try {
      const stat = await fs.stat(resolved.ref);
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(stat.size),
        },
      });
    } catch {
      return new NextResponse(null, { status: 404 });
    }
  }
  const stat = await getStorage().stat(resolved.ref);
  if (!stat) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(stat.size),
    },
  });
}
