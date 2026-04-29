/**
 * R36 — chat response/message shapes mirrored on the FE side.
 *
 * The API contract (`_workspace/api_contract.md` §4) commits BE to add
 * `ChatSourceSchema`/`ChatActionSchema` to `packages/shared/src/chat.ts`.
 * Until that lands, FE keeps a small forward-compat mirror so FE and BE can
 * develop in parallel without an import-order race (R34 learning). When BE
 * exposes the schemas we can swap these for `import type` lines without any
 * other call-site change.
 */
export type ChatMode = 'rag' | 'rule';
export type ChatActionKind = 'navigate' | 'palette' | 'tool' | 'prompt';
export type ChatToolName =
  | 'search_drawings'
  | 'get_drawing'
  | 'list_my_approvals'
  | 'get_recent_activity'
  | 'get_help';

export interface ChatSource {
  chunkId: string;
  source: string;
  title: string;
  similarity: number;
}

export interface ChatAction {
  /** id only present on quick-actions; per-message actions may omit. */
  id?: string;
  label: string;
  kind: ChatActionKind;
  href?: string;
  paletteQuery?: string;
  toolName?: ChatToolName;
  toolArgs?: Record<string, unknown>;
  /** kind='prompt' fills the composer instead of dispatching. */
  promptText?: string;
}

export interface ChatHealthStatus {
  pgvector: boolean;
  llmReachable: boolean;
  embeddingReachable: boolean;
  decision: ChatMode;
  reason: string;
  checkedAt: string;
}

/**
 * Wire shape of `POST /api/v1/chat`. Mirrors §3.1.
 */
export interface ChatPostResponse {
  sessionId: string;
  messageId: string;
  response: string;
  mode: ChatMode;
  sources?: ChatSource[];
  actions?: ChatAction[];
}

/**
 * Stored message — comes from `GET /api/v1/chat/sessions/[id]`.
 * `role` follows the Prisma enum casing (uppercase).
 */
export type ChatMessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

export interface ChatStoredMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  mode: 'RAG' | 'RULE';
  createdAt: string;
  sources?: ChatSource[];
  actions?: ChatAction[];
}

export interface ChatSessionSummary {
  id: string;
  title: string | null;
  updatedAt: string;
  messageCount: number;
}

export interface ChatSessionDetail {
  session: { id: string; title: string | null; updatedAt: string };
  messages: ChatStoredMessage[];
}

/**
 * In-memory representation a `<ChatPanel>` keeps. Includes ephemeral states
 * (pending, error) that don't persist to the BE.
 */
export interface ChatTurn {
  /** stable id; for pending/error turns we generate a client uuid prefix. */
  id: string;
  role: ChatMessageRole;
  content: string;
  mode?: 'RAG' | 'RULE';
  createdAt: string;
  sources?: ChatSource[];
  actions?: ChatAction[];
  /** BE-reflected. */
  status?: 'sent' | 'pending' | 'error';
  /** When status='error' — for retry surface. */
  error?: { message: string; retryable: boolean };
}

export interface QuickAction {
  id: string;
  label: string;
  kind: ChatActionKind;
  href?: string;
  paletteQuery?: string;
  toolName?: ChatToolName;
  toolArgs?: Record<string, unknown>;
  promptText?: string;
}
