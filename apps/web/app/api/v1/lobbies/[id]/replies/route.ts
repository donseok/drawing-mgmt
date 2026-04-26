// /api/v1/lobbies/:id/replies
//   GET  — list replies (oldest first) for a lobby the caller can see.
//   POST — append a new reply. Recipients of a target organization can post;
//          the requester can also post (e.g. to add a clarification). When a
//          target posts the lobby flips to IN_REVIEW so the inbox status
//          reflects activity.
//
// Body (POST):
//   { comment: string (1..2000), decision?: 'COMMENT' | 'APPROVE' | 'REJECT' | 'REVISE_REQUESTED' }
//
// Owned by BE (R19).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { LobbyReplyDecision, LobbyStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';

const postSchema = z.object({
  comment: z.string().min(1).max(2000),
  decision: z
    .enum(['COMMENT', 'APPROVE', 'REJECT', 'REVISE_REQUESTED'])
    .optional(),
});

async function loadLobbyForVisibility(id: string) {
  return prisma.lobby.findUnique({
    where: { id },
    select: {
      id: true,
      createdBy: true,
      status: true,
      targets: { select: { companyId: true } },
    },
  });
}

function canSee(
  user: { id: string; role: string; organizationId: string | null },
  lobby: NonNullable<Awaited<ReturnType<typeof loadLobbyForVisibility>>>,
): boolean {
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') return true;
  if (lobby.createdBy === user.id) return true;
  return (
    !!user.organizationId &&
    lobby.targets.some((t) => t.companyId === user.organizationId)
  );
}

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

  const lobby = await loadLobbyForVisibility(params.id);
  if (!lobby) return error(ErrorCode.E_NOT_FOUND);
  if (!canSee(user, lobby)) return error(ErrorCode.E_FORBIDDEN);

  const replies = await prisma.lobbyReply.findMany({
    where: { lobbyId: lobby.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      comment: true,
      decision: true,
      createdAt: true,
    },
  });

  // Resolve user names in one query so the FE can render `<author>` without
  // a second fetch per reply.
  const userIds = Array.from(new Set(replies.map((r) => r.userId)));
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, fullName: true, username: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return ok({
    items: replies.map((r) => ({
      id: r.id,
      userId: r.userId,
      author: byId.get(r.userId)?.fullName ?? byId.get(r.userId)?.username ?? '?',
      comment: r.comment,
      decision: r.decision,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const lobby = await loadLobbyForVisibility(params.id);
  if (!lobby) return error(ErrorCode.E_NOT_FOUND);
  if (!canSee(user, lobby)) return error(ErrorCode.E_FORBIDDEN);

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
  const decision: LobbyReplyDecision = (dto.decision ??
    'COMMENT') as LobbyReplyDecision;

  const isTarget =
    !!user.organizationId &&
    lobby.targets.some((t) => t.companyId === user.organizationId);

  // Status side-effect: a target reply on a NEW lobby flips it to IN_REVIEW.
  // APPROVE/REJECT decisions move further:
  //   APPROVE → COMPLETED
  //   REJECT  → IN_REVIEW (creator decides whether to recall + revise)
  // REVISE_REQUESTED is treated like a comment for the status badge but the
  // decision tag still surfaces in the FE.
  let nextStatus: LobbyStatus | null = null;
  if (isTarget && lobby.status === LobbyStatus.NEW) {
    nextStatus = LobbyStatus.IN_REVIEW;
  }
  if (decision === 'APPROVE') nextStatus = LobbyStatus.COMPLETED;
  if (decision === 'REJECT' && lobby.status !== LobbyStatus.COMPLETED) {
    nextStatus = LobbyStatus.IN_REVIEW;
  }

  const created = await prisma.$transaction(async (tx) => {
    const reply = await tx.lobbyReply.create({
      data: {
        lobbyId: lobby.id,
        userId: user.id,
        comment: dto.comment,
        decision,
      },
    });
    if (nextStatus) {
      await tx.lobby.update({
        where: { id: lobby.id },
        data: { status: nextStatus },
      });
    }
    return reply;
  });

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'LOBBY_REPLY',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      lobbyId: lobby.id,
      decision,
      statusFlip: nextStatus,
    },
  });

  return ok(
    {
      id: created.id,
      decision: created.decision,
      createdAt: created.createdAt,
      statusFlip: nextStatus,
    },
    undefined,
    { status: 201 },
  );
}
