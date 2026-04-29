// GET /api/v1/chat/quick-actions
//
// Returns the 7 quick-action chips the FE renders inside the chat panel
// landing screen. 6 are static; the "내 결재함" entry is dynamic — its label
// includes the caller's pending-approval count when > 0.
//
// The chips re-use the ChatAction shape from packages/shared so the FE can
// render them with the same component used for in-conversation suggestions.

import type { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';
import { withApi } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import type { ChatAction } from '@drawing-mgmt/shared';

interface QuickActionEntry extends ChatAction {
  id: string;
}

async function handleGet(): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const pendingApprovals = await prisma.approvalStep
    .count({
      where: { approverId: user.id, status: 'PENDING' },
    })
    .catch(() => 0);

  const actions: QuickActionEntry[] = [
    {
      id: 'open-search',
      label: '검색 페이지',
      kind: 'navigate',
      href: '/search',
    },
    {
      id: 'open-approval-inbox',
      label: pendingApprovals > 0 ? `내 결재함 (${pendingApprovals}건 대기)` : '내 결재함',
      kind: 'navigate',
      href: '/approvals',
    },
    {
      id: 'show-recent-activity',
      label: '최근 활동 보기',
      kind: 'prompt',
      promptText: '최근 활동 알려줘',
    },
    {
      id: 'open-pins',
      label: '내 즐겨찾기',
      kind: 'navigate',
      href: '/',
    },
    {
      id: 'show-shortcuts',
      label: '단축키 보기',
      kind: 'palette',
      paletteQuery: '단축키',
    },
    {
      id: 'show-help',
      label: '도움말 보기',
      kind: 'tool',
      toolName: 'get_help',
      toolArgs: { topic: 'getting-started' },
    },
    {
      id: 'find-by-number',
      label: '도면번호로 찾기',
      kind: 'prompt',
      promptText: '도면번호로 ',
    },
  ];

  return ok({ actions });
}

export const GET = withApi({ rateLimit: 'none' }, handleGet);
