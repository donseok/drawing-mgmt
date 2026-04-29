import { z } from 'zod';

// 챗봇 도구(Tool) 인풋 스키마 (TRD §14.5)
export const SearchDrawingsInputSchema = z.object({
  q: z.string().optional(),
  classCode: z.string().optional(),
  folderId: z.string().optional(),
  state: z.enum(['NEW', 'CHECKED_OUT', 'CHECKED_IN', 'IN_APPROVAL', 'APPROVED']).optional(),
  dateRange: z.string().optional(), // "2026" or "2026-04" or "2026-04-01..2026-04-30"
  limit: z.number().int().min(1).max(50).default(10),
});

export const GetDrawingInputSchema = z.object({
  number: z.string().optional(),
  id: z.string().optional(),
}).refine((v) => v.number || v.id, { message: 'number 또는 id 필요' });

export const ListMyApprovalsInputSchema = z.object({
  box: z.enum(['waiting', 'done', 'sent', 'trash']).default('waiting'),
});

export const GetRecentActivityInputSchema = z.object({
  objectId: z.string(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const GetHelpInputSchema = z.object({
  topic: z.string(),
});

export type ChatToolName =
  | 'search_drawings'
  | 'get_drawing'
  | 'list_my_approvals'
  | 'get_recent_activity'
  | 'get_help';

export const ChatToolNameSchema = z.enum([
  'search_drawings',
  'get_drawing',
  'list_my_approvals',
  'get_recent_activity',
  'get_help',
]);

export type ChatModeDecision = 'rag' | 'rule';

export interface ChatHealthStatus {
  pgvector: boolean;
  llmReachable: boolean;
  embeddingReachable: boolean;
  decision: ChatModeDecision;
  reason: string;
  checkedAt: string;
}

// R36 — 응답 sources/actions 공통 타입.
//
// `sources`는 RAG 모드에서 검색된 ManualChunk 메타. `actions`는 빠른 이동/실행
// 칩(navigate/palette/tool/prompt). ChatMessage.toolResults(JSON)에 함께
//직렬화돼 GET /chat/sessions/[id]에서 다시 풀어 반환된다.
export const ChatSourceSchema = z.object({
  chunkId: z.string(),
  source: z.string(),
  title: z.string(),
  similarity: z.number().min(0).max(1),
  // R36-polish — 청크 본문 미리보기(앞 600자 cap). FE의 출처 미리보기 모달이 사용한다.
  // 옵셔널: RULE 모드의 sources(빈 배열)는 영향 없고, 과거 데이터(toolResults JSON)
  // 재로드 시에도 누락은 무해.
  excerpt: z.string().max(600).optional(),
});
export type ChatSource = z.infer<typeof ChatSourceSchema>;

export const ChatActionKindSchema = z.enum(['navigate', 'palette', 'tool', 'prompt']);
export type ChatActionKind = z.infer<typeof ChatActionKindSchema>;

export const ChatActionSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  kind: ChatActionKindSchema,
  href: z.string().optional(),
  paletteQuery: z.string().optional(),
  toolName: ChatToolNameSchema.optional(),
  toolArgs: z.record(z.unknown()).optional(),
  promptText: z.string().optional(),
});
export type ChatAction = z.infer<typeof ChatActionSchema>;

// ──────────────────────────────────────────────────────────────────────────
// R36-polish — POST /chat NDJSON 스트림 이벤트 (계약 §2.2/§2.3).
//
// 시퀀스 불변식:
//   1) 첫 이벤트는 항상 'meta' (sessionId/messageId/mode 즉시 확정).
//   2) delta는 0개 이상 — FE는 text를 누적 concat.
//   3) sources/actions는 각각 0~1개. 일반적으로 done 직전.
//   4) 마지막 이벤트는 항상 'done' 또는 'error'. 'error' 발사 시에도 그 다음에
//      'done'을 한 번 더 발사해 reader 종료를 명확히 한다.
// 모든 라인은 `\n` 종료, line-by-line 파싱. 각 line은 단일 ChatStreamEvent JSON.
// ──────────────────────────────────────────────────────────────────────────

export const ChatStreamMetaSchema = z.object({
  type: z.literal('meta'),
  sessionId: z.string(),
  messageId: z.string(),
  mode: z.enum(['rag', 'rule']),
});
export type ChatStreamMeta = z.infer<typeof ChatStreamMetaSchema>;

export const ChatStreamDeltaSchema = z.object({
  type: z.literal('delta'),
  text: z.string(),
});
export type ChatStreamDelta = z.infer<typeof ChatStreamDeltaSchema>;

export const ChatStreamSourcesSchema = z.object({
  type: z.literal('sources'),
  sources: z.array(ChatSourceSchema),
});
export type ChatStreamSources = z.infer<typeof ChatStreamSourcesSchema>;

export const ChatStreamActionsSchema = z.object({
  type: z.literal('actions'),
  actions: z.array(ChatActionSchema),
});
export type ChatStreamActions = z.infer<typeof ChatStreamActionsSchema>;

export const ChatStreamErrorSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
});
export type ChatStreamError = z.infer<typeof ChatStreamErrorSchema>;

export const ChatStreamDoneSchema = z.object({
  type: z.literal('done'),
});
export type ChatStreamDone = z.infer<typeof ChatStreamDoneSchema>;

export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  ChatStreamMetaSchema,
  ChatStreamDeltaSchema,
  ChatStreamSourcesSchema,
  ChatStreamActionsSchema,
  ChatStreamErrorSchema,
  ChatStreamDoneSchema,
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
