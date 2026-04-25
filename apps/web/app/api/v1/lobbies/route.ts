// GET /api/v1/lobbies?box=received|sent|expired
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
// Response shape (per row):
//   {
//     id, title, description, expiresAt, status, createdAt, createdBy,
//     attachmentCount, targets: [{ companyId }]
//   }
//
// Owned by BE-2.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { LobbyStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { ensureLobbyDemoSeed } from '@/lib/demo-seed';

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
