// /api/v1/lobbies
//   GET  ?box=received|sent|expired — list inboxes (see comment block below).
//   POST                              — create a transmittal package (R18).
//
// Inboxes (BUG-004 / FE-2):
//   received — lobbies whose `targets` include the current user's organization.
//   sent     — lobbies created by the current user.
//   expired  — lobbies with status=EXPIRED OR expiresAt < now (regardless of
//              who created or received them — the 만료 함 surfaces stale
//              packages globally).
//
// On first request the table is seeded with 4 demo rows tied to existing
// organizations (협력업체 / 설계1팀) so the FE has something to render.
//
// POST creates a Lobby + LobbyAttachment rows (one per object's master file)
// + LobbyTargetCompany rows. Object permissions are checked per-row; rows the
// caller can't VIEW are dropped from the package (rather than failing the
// whole request) so a partially permitted selection still produces a useful
// transmittal.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { LobbyStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  loadFolderPermissions,
  toPermissionUser,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { ensureLobbyDemoSeed } from '@/lib/demo-seed';
import { extractRequestMeta, logActivity } from '@/lib/audit';

const querySchema = z.object({
  box: z.enum(['received', 'sent', 'expired']).default('received'),
});

const baseInclude = {
  targets: { select: { id: true, companyId: true } },
  _count: { select: { attachments: true } },
} as const;

export async function GET(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    box: url.searchParams.get('box') ?? 'received',
  });
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { box } = parsed.data;

  await ensureLobbyDemoSeed();

  const now = new Date();
  let where: Prisma.LobbyWhereInput;

  if (box === 'sent') {
    where = { createdBy: user.id };
  } else if (box === 'expired') {
    where = {
      OR: [{ status: LobbyStatus.EXPIRED }, { expiresAt: { lt: now } }],
    };
  } else {
    // received — user's organization is in targets.
    if (!user.organizationId) {
      return ok([]);
    }
    where = {
      targets: { some: { companyId: user.organizationId } },
    };
  }

  const rows = await prisma.lobby.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: baseInclude,
  });

  // Flatten _count -> attachmentCount for a friendlier shape.
  const data = rows.map((r) => {
    const { _count, ...rest } = r;
    return { ...rest, attachmentCount: _count.attachments };
  });

  return ok(data);
}

const postSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** ISO 8601 date string. Past dates are rejected. */
  expiresAt: z.string().datetime().optional(),
  /** Object ids whose master attachments populate the package. 1..200. */
  objectIds: z.array(z.string().min(1)).min(1).max(200),
  /** Recipient organization ids. Empty = visible only via 'sent' inbox. */
  targetCompanyIds: z.array(z.string().min(1)).max(50).optional(),
  /** Optional override; defaults to the first object's folder so the lobby
   *  surfaces under the same permission tree. */
  folderId: z.string().min(1).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const dto = parsed.data;

  if (dto.expiresAt) {
    const expires = new Date(dto.expiresAt);
    if (Number.isNaN(expires.getTime())) {
      return error(ErrorCode.E_VALIDATION, '만료일 형식이 올바르지 않습니다.');
    }
    if (expires.getTime() < Date.now()) {
      return error(ErrorCode.E_VALIDATION, '만료일이 과거입니다.');
    }
  }

  const uniqueObjectIds = Array.from(new Set(dto.objectIds));
  const objs = await prisma.objectEntity.findMany({
    where: { id: { in: uniqueObjectIds }, deletedAt: null },
    select: {
      id: true,
      number: true,
      folderId: true,
      ownerId: true,
      securityLevel: true,
      // Master attachment lookup — Lobby attachments mirror filename + path
      // so a future recipient endpoint can stream them without touching the
      // source object record.
      revisions: {
        orderBy: { rev: 'desc' },
        take: 1,
        select: {
          versions: {
            orderBy: { ver: 'desc' },
            take: 1,
            select: {
              attachments: {
                where: { isMaster: true },
                take: 1,
                select: {
                  filename: true,
                  storagePath: true,
                  mimeType: true,
                  size: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (objs.length === 0) {
    return error(ErrorCode.E_VALIDATION, '패키지에 포함할 자료가 없습니다.');
  }

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);
  const folderIds = Array.from(new Set(objs.map((o) => o.folderId)));
  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions(folderIds),
  ]);

  // Drop rows the caller can't VIEW so we don't ship anyone a drawing they
  // weren't supposed to see. Rows without a master attachment are also
  // skipped — empty attachments aren't useful in a transmittal.
  type AttachmentTuple = {
    filename: string;
    storagePath: string;
    mimeType: string;
    size: bigint;
  };
  const includedAttachments: AttachmentTuple[] = [];
  let dropped = 0;
  for (const o of objs) {
    const decision = canAccess(pUser, o, perms, 'VIEW');
    if (!decision.allowed) {
      dropped++;
      continue;
    }
    const att = o.revisions[0]?.versions[0]?.attachments[0];
    if (!att) {
      dropped++;
      continue;
    }
    includedAttachments.push({
      filename: att.filename,
      storagePath: att.storagePath,
      mimeType: att.mimeType,
      size: att.size,
    });
  }

  if (includedAttachments.length === 0) {
    return error(
      ErrorCode.E_VALIDATION,
      '패키지에 포함할 첨부 파일이 없습니다.',
    );
  }

  const folderId = dto.folderId ?? objs[0]!.folderId;

  // Validate target organizations exist when supplied — better error than the
  // foreign-key violation we'd otherwise dump on the caller.
  const targetCompanyIds = Array.from(new Set(dto.targetCompanyIds ?? []));
  if (targetCompanyIds.length > 0) {
    const found = await prisma.organization.findMany({
      where: { id: { in: targetCompanyIds } },
      select: { id: true },
    });
    if (found.length !== targetCompanyIds.length) {
      return error(
        ErrorCode.E_VALIDATION,
        '존재하지 않는 대상 조직이 포함되어 있습니다.',
      );
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const lobby = await tx.lobby.create({
      data: {
        folderId,
        title: dto.title,
        description: dto.description ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        status: LobbyStatus.NEW,
        createdBy: user.id,
      },
    });
    if (includedAttachments.length > 0) {
      await tx.lobbyAttachment.createMany({
        data: includedAttachments.map((a) => ({
          lobbyId: lobby.id,
          filename: a.filename,
          storagePath: a.storagePath,
          mimeType: a.mimeType,
          size: a.size,
        })),
      });
    }
    if (targetCompanyIds.length > 0) {
      await tx.lobbyTargetCompany.createMany({
        data: targetCompanyIds.map((cid) => ({
          lobbyId: lobby.id,
          companyId: cid,
        })),
      });
    }
    return lobby;
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'LOBBY_CREATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      lobbyId: created.id,
      attachments: includedAttachments.length,
      targets: targetCompanyIds.length,
      droppedFromSelection: dropped,
    },
  });

  return ok(
    {
      id: created.id,
      attachmentCount: includedAttachments.length,
      targetCount: targetCompanyIds.length,
      droppedFromSelection: dropped,
    },
    undefined,
    { status: 201 },
  );
}

// Quiet the unused-warning when the typecheck pass elides Prisma. We keep the
// import for the WhereInput type used in GET above.
void Prisma;
