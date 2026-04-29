// R36 — Chat tool executors.
//
// 5 tools defined in packages/shared/src/chat.ts:
//   - search_drawings        — meta search over ObjectEntity (number/name/desc)
//   - get_drawing            — fetch single drawing by number or id
//   - list_my_approvals      — caller's approval steps in 4 boxes
//   - get_recent_activity    — recent ActivityLog rows for an object
//   - get_help               — short stub returning a topic snippet
//
// Each tool runs server-side with the caller's full permission context
// applied: securityLevel + role + organizationId + groupIds drive the same
// `canAccess` evaluation used by `/api/v1/objects` and friends, so the chat
// surface can never expose drawings that FolderPermission denies.
//
// Inputs are zod-parsed (the schemas already exist in shared). Output is a
// stable JSON-serializable shape consumed by either the LLM (tool_call
// results) or the orchestrator (when the FE clicks an action chip).

import { Prisma, type ObjectState, type Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  SearchDrawingsInputSchema,
  GetDrawingInputSchema,
  ListMyApprovalsInputSchema,
  GetRecentActivityInputSchema,
  GetHelpInputSchema,
  type ChatToolName,
} from '@drawing-mgmt/shared';
import { canAccess, loadFolderPermissions } from '@/lib/permissions';
import type { PermissionUser } from '@drawing-mgmt/shared/permissions';

export interface ToolUserCtx {
  id: string;
  securityLevel: number;
  role: string;
  organizationId: string | null;
  groupIds: string[];
}

function toPermissionUserFromCtx(user: ToolUserCtx): PermissionUser {
  return {
    id: user.id,
    role: user.role as Role,
    securityLevel: user.securityLevel,
    organizationId: user.organizationId,
    groupIds: user.groupIds,
  };
}

export interface ToolResult {
  ok: boolean;
  toolName: ChatToolName;
  data?: unknown;
  error?: { code: string; message: string };
}

/**
 * Execute a chat tool by name. Returns a ToolResult with `.ok=false` for
 * input-validation errors (so the orchestrator/LLM can surface a helpful
 * message rather than the route 500-ing). Genuinely unexpected exceptions
 * propagate.
 */
export async function executeTool(
  name: ChatToolName,
  args: unknown,
  user: ToolUserCtx,
): Promise<ToolResult> {
  switch (name) {
    case 'search_drawings':
      return runSearchDrawings(args, user);
    case 'get_drawing':
      return runGetDrawing(args, user);
    case 'list_my_approvals':
      return runListMyApprovals(args, user);
    case 'get_recent_activity':
      return runGetRecentActivity(args, user);
    case 'get_help':
      return runGetHelp(args);
    default:
      // Exhaustive switch; never expected because TS narrows ChatToolName.
      return {
        ok: false,
        toolName: name,
        error: { code: 'UNKNOWN_TOOL', message: `알 수 없는 도구: ${String(name)}` },
      };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// search_drawings
// ────────────────────────────────────────────────────────────────────────────

async function runSearchDrawings(args: unknown, user: ToolUserCtx): Promise<ToolResult> {
  const parsed = SearchDrawingsInputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      toolName: 'search_drawings',
      error: { code: 'INVALID_INPUT', message: parsed.error.errors[0]?.message ?? '잘못된 입력' },
    };
  }
  const q = parsed.data;

  const where: Prisma.ObjectEntityWhereInput = {
    deletedAt: null,
    securityLevel: { gte: user.securityLevel },
  };
  if (q.q && q.q.trim()) {
    const term = q.q.trim();
    where.OR = [
      { number: { contains: term, mode: 'insensitive' } },
      { name: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
    ];
  }
  if (q.classCode) where.class = { code: q.classCode };
  if (q.folderId) where.folderId = q.folderId;
  if (q.state) where.state = q.state as ObjectState;
  if (q.dateRange) {
    const range = parseDateRange(q.dateRange);
    if (range) where.createdAt = { gte: range.from, lt: range.to };
  }

  const rows = await prisma.objectEntity.findMany({
    where,
    take: q.limit,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      number: true,
      name: true,
      state: true,
      currentRevision: true,
      currentVersion: true,
      ownerId: true,
      folderId: true,
      securityLevel: true,
      updatedAt: true,
      class: { select: { code: true, name: true } },
      folder: { select: { id: true, name: true, folderCode: true } },
    },
  });

  const pUser = toPermissionUserFromCtx(user);
  const folderIds = Array.from(new Set(rows.map((r) => r.folderId)));
  const perms = await loadFolderPermissions(folderIds);
  const visible = rows.filter(
    (r) =>
      canAccess(
        pUser,
        { id: r.id, folderId: r.folderId, ownerId: r.ownerId, securityLevel: r.securityLevel },
        perms,
        'VIEW',
      ).allowed,
  );

  return {
    ok: true,
    toolName: 'search_drawings',
    data: {
      count: visible.length,
      items: visible.map((r) => ({
        id: r.id,
        number: r.number,
        name: r.name,
        state: r.state,
        revision: r.currentRevision,
        version: r.currentVersion.toString(),
        classCode: r.class.code,
        folderName: r.folder.name,
        updatedAt: r.updatedAt.toISOString(),
        href: `/objects/${r.id}`,
      })),
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// get_drawing
// ────────────────────────────────────────────────────────────────────────────

async function runGetDrawing(args: unknown, user: ToolUserCtx): Promise<ToolResult> {
  const parsed = GetDrawingInputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      toolName: 'get_drawing',
      error: { code: 'INVALID_INPUT', message: parsed.error.errors[0]?.message ?? '잘못된 입력' },
    };
  }
  const q = parsed.data;

  const row = await prisma.objectEntity.findFirst({
    where: {
      deletedAt: null,
      securityLevel: { gte: user.securityLevel },
      OR: [q.id ? { id: q.id } : null, q.number ? { number: q.number } : null].filter(
        (x): x is { id: string } | { number: string } => Boolean(x),
      ),
    },
    select: {
      id: true,
      number: true,
      name: true,
      description: true,
      state: true,
      currentRevision: true,
      currentVersion: true,
      securityLevel: true,
      ownerId: true,
      folderId: true,
      updatedAt: true,
      owner: { select: { id: true, fullName: true } },
      class: { select: { code: true, name: true } },
      folder: { select: { id: true, name: true } },
    },
  });

  if (!row) {
    return {
      ok: false,
      toolName: 'get_drawing',
      error: { code: 'NOT_FOUND', message: '해당 도면을 찾을 수 없거나 권한이 없습니다.' },
    };
  }

  const pUser = toPermissionUserFromCtx(user);
  const perms = await loadFolderPermissions([row.folderId]);
  const decision = canAccess(
    pUser,
    { id: row.id, folderId: row.folderId, ownerId: row.ownerId, securityLevel: row.securityLevel },
    perms,
    'VIEW',
  );
  if (!decision.allowed) {
    return {
      ok: false,
      toolName: 'get_drawing',
      error: { code: 'NOT_FOUND', message: '해당 도면을 찾을 수 없거나 권한이 없습니다.' },
    };
  }

  return {
    ok: true,
    toolName: 'get_drawing',
    data: {
      id: row.id,
      number: row.number,
      name: row.name,
      description: row.description,
      state: row.state,
      revision: row.currentRevision,
      version: row.currentVersion.toString(),
      securityLevel: row.securityLevel,
      classCode: row.class.code,
      className: row.class.name,
      folderName: row.folder.name,
      ownerName: row.owner.fullName,
      updatedAt: row.updatedAt.toISOString(),
      href: `/objects/${row.id}`,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// list_my_approvals
// ────────────────────────────────────────────────────────────────────────────

async function runListMyApprovals(args: unknown, user: ToolUserCtx): Promise<ToolResult> {
  const parsed = ListMyApprovalsInputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      toolName: 'list_my_approvals',
      error: { code: 'INVALID_INPUT', message: parsed.error.errors[0]?.message ?? '잘못된 입력' },
    };
  }
  const { box } = parsed.data;

  let rows: Array<{
    approvalId: string;
    title: string;
    status: string;
    requestedAt: Date;
    actedAt: Date | null;
    href: string;
  }> = [];

  if (box === 'waiting') {
    const steps = await prisma.approvalStep.findMany({
      where: { approverId: user.id, status: 'PENDING' },
      orderBy: { approval: { createdAt: 'desc' } },
      take: 30,
      include: { approval: { select: { id: true, title: true, status: true, createdAt: true } } },
    });
    rows = steps.map((s) => ({
      approvalId: s.approval.id,
      title: s.approval.title,
      status: s.approval.status,
      requestedAt: s.approval.createdAt,
      actedAt: null,
      href: `/approval?box=${box}`,
    }));
  } else if (box === 'done') {
    const steps = await prisma.approvalStep.findMany({
      where: { approverId: user.id, status: { in: ['APPROVED', 'REJECTED'] } },
      orderBy: { actedAt: 'desc' },
      take: 30,
      include: { approval: { select: { id: true, title: true, status: true, createdAt: true } } },
    });
    rows = steps.map((s) => ({
      approvalId: s.approval.id,
      title: s.approval.title,
      status: s.approval.status,
      requestedAt: s.approval.createdAt,
      actedAt: s.actedAt,
      href: `/approval?box=${box}`,
    }));
  } else if (box === 'sent') {
    const approvals = await prisma.approval.findMany({
      where: { requesterId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, title: true, status: true, createdAt: true, completedAt: true },
    });
    rows = approvals.map((a) => ({
      approvalId: a.id,
      title: a.title,
      status: a.status,
      requestedAt: a.createdAt,
      actedAt: a.completedAt,
      href: `/approval?box=${box}`,
    }));
  } else {
    // 'trash' — cancelled approvals authored by user.
    const approvals = await prisma.approval.findMany({
      where: { requesterId: user.id, status: 'CANCELLED' },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, title: true, status: true, createdAt: true, completedAt: true },
    });
    rows = approvals.map((a) => ({
      approvalId: a.id,
      title: a.title,
      status: a.status,
      requestedAt: a.createdAt,
      actedAt: a.completedAt,
      href: `/approval?box=${box}`,
    }));
  }

  return {
    ok: true,
    toolName: 'list_my_approvals',
    data: {
      box,
      count: rows.length,
      items: rows.map((r) => ({
        approvalId: r.approvalId,
        title: r.title,
        status: r.status,
        requestedAt: r.requestedAt.toISOString(),
        actedAt: r.actedAt?.toISOString() ?? null,
        href: r.href,
      })),
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// get_recent_activity
// ────────────────────────────────────────────────────────────────────────────

async function runGetRecentActivity(args: unknown, user: ToolUserCtx): Promise<ToolResult> {
  const parsed = GetRecentActivityInputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      toolName: 'get_recent_activity',
      error: { code: 'INVALID_INPUT', message: parsed.error.errors[0]?.message ?? '잘못된 입력' },
    };
  }
  const q = parsed.data;

  // Caller must have securityLevel-clearance for the object.
  const obj = await prisma.objectEntity.findFirst({
    where: {
      id: q.objectId,
      deletedAt: null,
      securityLevel: { gte: user.securityLevel },
    },
    select: { id: true, number: true, name: true },
  });
  if (!obj) {
    return {
      ok: false,
      toolName: 'get_recent_activity',
      error: { code: 'NOT_FOUND', message: '해당 도면을 찾을 수 없거나 권한이 없습니다.' },
    };
  }

  const rows = await prisma.activityLog.findMany({
    where: { objectId: q.objectId },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
    include: { user: { select: { id: true, fullName: true } } },
  });

  return {
    ok: true,
    toolName: 'get_recent_activity',
    data: {
      object: { id: obj.id, number: obj.number, name: obj.name },
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        userName: r.user.fullName,
        createdAt: r.createdAt.toISOString(),
      })),
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// get_help
// ────────────────────────────────────────────────────────────────────────────
//
// Light static dictionary of help topics. The chatbot's RAG path covers most
// help requests via the docs corpus; this tool is the deterministic
// fallback for action-chip "도움말 보기" without an LLM.

const HELP_TOPICS: Record<string, { title: string; body: string }> = {
  'getting-started': {
    title: '시작하기',
    body:
      '도면을 찾으려면 상단 검색창을 사용하세요. 폴더에 들어가 도면 카드를 클릭하면 상세 페이지가 열립니다. 편집은 체크아웃 → 새 첨부 업로드 → 체크인 순서로 진행돼요.',
  },
  'shortcuts': {
    title: '단축키',
    body: '⌘K(Ctrl+K) 명령 팔레트, ⌘/ 단축키 도움말, G H 홈, G S 검색, G A 결재함.',
  },
  'approvals': {
    title: '결재',
    body:
      '체크인된 개정본의 도면 상세에서 결재 상신을 누르고 결재선을 정합니다. 모든 단계가 승인되면 자동으로 APPROVED 상태로 바뀝니다.',
  },
  'permissions': {
    title: '권한',
    body:
      '폴더별로 보기/수정/삭제/승인/다운로드/인쇄 권한이 부여됩니다. 도면 보안레벨(1~5)이 사용자 보안레벨보다 낮으면 보이지 않아요. 폴더 관리자에게 권한 부여를 요청하세요.',
  },
};

async function runGetHelp(args: unknown): Promise<ToolResult> {
  const parsed = GetHelpInputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      toolName: 'get_help',
      error: { code: 'INVALID_INPUT', message: parsed.error.errors[0]?.message ?? '잘못된 입력' },
    };
  }
  const topic = parsed.data.topic.toLowerCase().trim();
  const entry = HELP_TOPICS[topic] ?? HELP_TOPICS['getting-started']!;
  return {
    ok: true,
    toolName: 'get_help',
    data: {
      topic,
      title: entry.title,
      body: entry.body,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Date-range helper (matches /api/v1/objects parsing)
// ────────────────────────────────────────────────────────────────────────────

function parseDateRange(raw: string): { from: Date; to: Date } | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{4}$/.test(value)) {
    const y = parseInt(value, 10);
    return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y + 1, 0, 1)) };
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [yStr, mStr] = value.split('-');
    const y = parseInt(yStr!, 10);
    const m = parseInt(mStr!, 10) - 1;
    return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 1)) };
  }
  if (/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [a, b] = value.split('..');
    const from = new Date(`${a}T00:00:00Z`);
    const to = new Date(`${b}T00:00:00Z`);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) return null;
    return { from, to };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// LLM tool definitions (passed to /chat/completions when RAG is on)
// ────────────────────────────────────────────────────────────────────────────

import type { LlmToolDefinition } from './llm';

export const LLM_TOOL_DEFINITIONS: LlmToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_drawings',
      description: '도면을 키워드/번호/폴더/상태로 검색합니다.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          classCode: { type: 'string' },
          folderId: { type: 'string' },
          state: {
            type: 'string',
            enum: ['NEW', 'CHECKED_OUT', 'CHECKED_IN', 'IN_APPROVAL', 'APPROVED'],
          },
          dateRange: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_drawing',
      description: '도면번호 또는 id로 단일 도면 상세를 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          number: { type: 'string' },
          id: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_my_approvals',
      description: '본인의 결재 박스(대기/완료/상신/취소) 항목을 가져옵니다.',
      parameters: {
        type: 'object',
        properties: {
          box: { type: 'string', enum: ['waiting', 'done', 'sent', 'trash'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_activity',
      description: '특정 도면의 최근 변경/체크인/결재 활동을 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          objectId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['objectId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_help',
      description: '특정 토픽의 도움말 본문을 가져옵니다.',
      parameters: {
        type: 'object',
        properties: { topic: { type: 'string' } },
        required: ['topic'],
      },
    },
  },
];
