// GET /api/v1/lobbies/:id
//
// Returns a single lobby package with its attachments and target companies.
// Visibility: creator, members of any target organization, or admin roles.
//
// Response shape:
//   {
//     id, title, description, expiresAt, status, createdAt, folderId,
//     createdBy, attachments: [{ id, filename, mimeType, size, createdAt }],
//     targets: [{ id, companyId }]
//   }
//
// Owned by BE-2.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const lobby = await prisma.lobby.findUnique({
    where: { id: params.id },
    include: {
      attachments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          size: true,
          createdAt: true,
        },
      },
      targets: { select: { id: true, companyId: true } },
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

  return ok(lobby);
}
