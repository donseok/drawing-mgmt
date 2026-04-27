/**
 * GET /api/v1/attachments/[id]/thumbnail
 *
 * R29 V-INF-6 — auth-gated PNG thumbnail produced by the conversion worker.
 *
 * Resolution order:
 *   1. Most recent DONE `ConversionJob.thumbnailPath` (the worker writes
 *      this on success). This survives even if the on-disk layout changes.
 *   2. Fall back to `${FILE_STORAGE_ROOT}/<attachmentId>/thumbnail.png` so
 *      we don't break for jobs that ran before the column existed.
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
 */

import { NextResponse } from 'next/server';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  toPermissionUser,
  loadFolderPermissions,
} from '@/lib/permissions';
import { error, ErrorCode } from '@/lib/api-response';

export const runtime = 'nodejs';

const STORAGE_ROOT = path.isAbsolute(process.env.FILE_STORAGE_ROOT ?? '')
  ? path.resolve(process.env.FILE_STORAGE_ROOT!)
  : path.resolve(
      process.cwd(),
      process.env.FILE_STORAGE_ROOT ?? './.data/files',
    );

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

/**
 * Resolve the thumbnail file path for an attachment by consulting the most
 * recent DONE ConversionJob first, then falling back to the canonical
 * on-disk location. Returns null when nothing usable exists.
 */
async function resolveThumbnailFile(
  attachmentId: string,
): Promise<string | null> {
  // 1) Prefer the persisted column — the worker writes it on success.
  const job = await prisma.conversionJob.findFirst({
    where: { attachmentId, status: 'DONE', thumbnailPath: { not: null } },
    orderBy: { finishedAt: 'desc' },
    select: { thumbnailPath: true },
  });
  if (job?.thumbnailPath) {
    if (await exists(job.thumbnailPath)) return job.thumbnailPath;
  }

  // 2) Legacy fallback — pre-R29 jobs put the file under STORAGE_ROOT but
  // never recorded the path. Allow only attachment ids that look safe.
  if (!/^[A-Za-z0-9_\-]+$/.test(attachmentId)) return null;
  const fallback = path.join(STORAGE_ROOT, attachmentId, 'thumbnail.png');
  if (await exists(fallback)) return fallback;
  return null;
}

async function exists(p: string): Promise<boolean> {
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

  const filePath = await resolveThumbnailFile(ctx.params.id);
  if (!filePath) {
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

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }

  // 4) Stream — keeps memory flat regardless of thumbnail size.
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(stat.size),
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
  const filePath = await resolveThumbnailFile(ctx.params.id);
  if (!filePath) return new NextResponse(null, { status: 404 });
  try {
    const stat = await fs.stat(filePath);
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
