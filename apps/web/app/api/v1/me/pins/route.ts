// /api/v1/me/pins
//   GET   ?type=folder|object  — list current user's pins (default: both kinds)
//   POST  { type, targetId }    — add a pin (idempotent — already-pinned is 200)
//
// R7 (workspace personalization). Pins are per-user shortcuts. We surface
// minimal payloads for each kind (folder code/name, object number/name) so
// the home + sidebar widgets render without a follow-up fetch.
//
// Owned by BE (R7).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';

const pinTypeSchema = z.enum(['folder', 'object']);

const querySchema = z.object({
  type: pinTypeSchema.optional(),
});

const postSchema = z.object({
  type: pinTypeSchema,
  targetId: z.string().min(1).max(64),
});

export interface PinFolderPayload {
  kind: 'folder';
  pinId: string;
  sortOrder: number;
  folder: { id: string; name: string; folderCode: string };
}
export interface PinObjectPayload {
  kind: 'object';
  pinId: string;
  sortOrder: number;
  object: { id: string; number: string; name: string; state: string };
}
export type PinPayload = PinFolderPayload | PinObjectPayload;

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
    type: url.searchParams.get('type') ?? undefined,
  });
  if (!parsed.success) {
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { type } = parsed.data;

  const wantFolder = type === undefined || type === 'folder';
  const wantObject = type === undefined || type === 'object';

  const [folderPins, objectPins] = await Promise.all([
    wantFolder
      ? prisma.userFolderPin.findMany({
          where: { userId: user.id },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            folder: { select: { id: true, name: true, folderCode: true } },
          },
        })
      : Promise.resolve([]),
    wantObject
      ? prisma.userObjectPin.findMany({
          where: { userId: user.id },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            object: {
              select: { id: true, number: true, name: true, state: true },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const items: PinPayload[] = [
    ...folderPins.map<PinFolderPayload>((p) => ({
      kind: 'folder',
      pinId: p.id,
      sortOrder: p.sortOrder,
      folder: p.folder,
    })),
    ...objectPins.map<PinObjectPayload>((p) => ({
      kind: 'object',
      pinId: p.id,
      sortOrder: p.sortOrder,
      object: p.object,
    })),
  ];

  return ok({ items });
}

export const POST = withApi({ rateLimit: 'api' }, async (req: Request) => {
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
    return error(ErrorCode.E_VALIDATION, undefined, undefined, parsed.error.flatten());
  }
  const { type, targetId } = parsed.data;

  // Verify the target exists before pinning so we never create dangling
  // pins. The unique constraint also protects against duplicates if two
  // tabs race on the same folder.
  if (type === 'folder') {
    const folder = await prisma.folder.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, folderCode: true },
    });
    if (!folder) return error(ErrorCode.E_NOT_FOUND, '폴더를 찾을 수 없습니다.');

    // sortOrder = MAX(existing) + 1 so the new pin lands at the bottom of
    // the user's list. Reordering is handled separately (drag-and-drop card).
    const maxOrder = await prisma.userFolderPin.aggregate({
      where: { userId: user.id },
      _max: { sortOrder: true },
    });
    const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    const pin = await prisma.userFolderPin.upsert({
      where: { userId_folderId: { userId: user.id, folderId: folder.id } },
      update: {},
      create: {
        userId: user.id,
        folderId: folder.id,
        sortOrder: nextOrder,
      },
    });

    const payload: PinFolderPayload = {
      kind: 'folder',
      pinId: pin.id,
      sortOrder: pin.sortOrder,
      folder,
    };
    return ok(payload, undefined, { status: 201 });
  }

  // type === 'object'
  const object = await prisma.objectEntity.findUnique({
    where: { id: targetId },
    select: { id: true, number: true, name: true, state: true, deletedAt: true },
  });
  if (!object || object.deletedAt) {
    return error(ErrorCode.E_NOT_FOUND, '자료를 찾을 수 없습니다.');
  }

  const maxOrder = await prisma.userObjectPin.aggregate({
    where: { userId: user.id },
    _max: { sortOrder: true },
  });
  const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  const pin = await prisma.userObjectPin.upsert({
    where: { userId_objectId: { userId: user.id, objectId: object.id } },
    update: {},
    create: {
      userId: user.id,
      objectId: object.id,
      sortOrder: nextOrder,
    },
  });

  const payload: PinObjectPayload = {
    kind: 'object',
    pinId: pin.id,
    sortOrder: pin.sortOrder,
    object: {
      id: object.id,
      number: object.number,
      name: object.name,
      state: object.state,
    },
  };
  return ok(payload, undefined, { status: 201 });
});
