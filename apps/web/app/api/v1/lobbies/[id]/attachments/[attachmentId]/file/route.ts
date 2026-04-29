// GET /api/v1/lobbies/:id/attachments/:attachmentId/file
//
// R20 — stream a single LobbyAttachment file. The lobby's storagePath mirrors
// the source ObjectEntity attachment (set up by R18's transmittal flow), so
// we resolve the same on-disk path and stream it under
// `Content-Disposition: attachment` with RFC 5987 filename encoding.
//
// Visibility mirrors the lobby detail GET: creator, members of any target
// org, or admin roles. Anyone else gets 403 — this stops a stray link share
// from surfacing a partner's drawing to a non-target user.
//
// Owned by BE (R20).

import { NextResponse } from 'next/server';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { error, ErrorCode } from '@/lib/api-response';
import { isInfected } from '@/lib/scan-guard';

const STORAGE_ROOT = path.resolve(process.env.FILE_STORAGE_ROOT ?? './.data/files');

export async function GET(
  _req: Request,
  { params }: { params: { id: string; attachmentId: string } },
): Promise<Response> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const lobby = await prisma.lobby.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      createdBy: true,
      targets: { select: { companyId: true } },
    },
  });
  if (!lobby) return error(ErrorCode.E_NOT_FOUND);

  const isPrivileged = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
  const isCreator = lobby.createdBy === user.id;
  const isTarget =
    !!user.organizationId &&
    lobby.targets.some((t) => t.companyId === user.organizationId);
  if (!isPrivileged && !isCreator && !isTarget) {
    return error(ErrorCode.E_FORBIDDEN);
  }

  const attachment = await prisma.lobbyAttachment.findUnique({
    where: { id: params.attachmentId },
    select: { id: true, lobbyId: true, filename: true, mimeType: true, storagePath: true },
  });
  if (!attachment || attachment.lobbyId !== lobby.id) {
    return error(ErrorCode.E_NOT_FOUND);
  }

  // R47/H-5 — virus-scan gate. The lobby attachment row mirrors the source
  // attachment's storagePath; if any source row with that path is INFECTED we
  // refuse to stream the bytes, matching the policy on /attachments/[id]/file.
  // This prevents the lobby flow from being a malware proxy when ClamAV flags
  // a file post-upload.
  const sourceScan = await prisma.attachment.findFirst({
    where: { storagePath: attachment.storagePath },
    select: { virusScanStatus: true, virusScanSig: true },
  });
  if (sourceScan && isInfected(sourceScan.virusScanStatus)) {
    return error(
      ErrorCode.E_FORBIDDEN,
      `바이러스 감염 — 다운로드 차단 (${sourceScan.virusScanSig ?? '시그니처 미상'})`,
    );
  }

  // The storagePath in R18 is the source attachment's `storagePath` field —
  // typically `<id>/source.<ext>` under `STORAGE_ROOT`. We treat any path
  // that escapes the storage root as untrusted and reject; otherwise we look
  // for an exact file or fall back to the canonical `<id>/source.*` shape.
  const sourcePath = await resolveStoragePath(attachment.storagePath);
  if (!sourcePath) return new NextResponse('Not Found', { status: 404 });

  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat) return new NextResponse('Not Found', { status: 404 });

  const nodeStream = createReadStream(sourcePath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${encodeFilename(attachment.filename)}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}

async function resolveStoragePath(storagePath: string): Promise<string | null> {
  // Reject directory escape attempts before touching the FS.
  const candidate = path.resolve(STORAGE_ROOT, storagePath);
  if (!candidate.startsWith(STORAGE_ROOT)) return null;
  if (await exists(candidate)) return candidate;
  // Fall back: storagePath sometimes encodes only the original attachment id
  // (e.g. `att-1`) — try `<id>/source.*` under the storage root.
  const dir = path.join(STORAGE_ROOT, storagePath);
  try {
    const entries = await fs.readdir(dir);
    const source = entries.find((n) => n.startsWith('source.'));
    if (source) return path.join(dir, source);
  } catch {
    /* ignore */
  }
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

function encodeFilename(name: string): string {
  return name.replace(/[\r\n"]/g, '').replace(/[^\x20-\x7E]/g, '_');
}
