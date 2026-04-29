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
