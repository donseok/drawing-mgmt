// R36 — Chat orchestrator.
//
// Pipeline:
//   1) Resolve / create ChatSession (own-only).
//   2) Persist user message.
//   3) Decide mode:
//        - embedding configured AND retriever returns chunks AND top-1
//          similarity ≥ threshold  → RAG
//        - else → RULE
//   4) Compose response:
//        - RAG with LLM: forward (system prompt + retrieved context + recent
//          history + tools) to /chat/completions; if the model asks for a
//          tool, execute and round-trip once; final assistant text is the
//          response. sources/actions populated from retrieval + tool results.
//        - RAG without LLM: template-quote the top-1 chunk; sources still
//          populated.
//        - RULE: matchRule() supplies response + actions.
//   5) Persist assistant message (mode/tokens/model/toolCalls/toolResults).
//   6) Return ChatPostResponse.
//
// Errors in the LLM/embedding/tool path fall back to rule mode rather than
// 5xx-ing the user.

import type { ChatRole as PrismaChatRole, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
  ChatAction,
  ChatSource,
  ChatModeDecision,
  ChatToolName,
} from '@drawing-mgmt/shared';
import { embed, getEmbedderConfig } from './embedder';
import { retrieveChunks, getSimilarityThreshold, type RetrievedChunk } from './retriever';
import { matchRule } from './rules';
import { generate, getLlmConfig, type LlmMessage } from './llm';
import { executeTool, LLM_TOOL_DEFINITIONS, type ToolUserCtx, type ToolResult } from './tools';

export interface OrchestratorInput {
  user: ToolUserCtx & { id: string };
  message: string;
  /** When provided, must already be verified to belong to `user.id`. */
  sessionId?: string;
}

export interface OrchestratorOutput {
  sessionId: string;
  messageId: string;
  response: string;
  mode: ChatModeDecision;
  sources?: ChatSource[];
  actions?: ChatAction[];
}

const MAX_HISTORY_TURNS = 6; // 사용자/어시스턴트 합산 메시지 수.

export async function handleChatTurn(input: OrchestratorInput): Promise<OrchestratorOutput> {
  const session = await ensureSession(input.user.id, input.sessionId, input.message);

  // 1) Persist the user message immediately. We use a single transaction at
  //    the end to also bump session.updatedAt + insert assistant; for now
  //    insert the user row up front so a crash mid-pipeline still leaves a
  //    record of what they typed.
  const userMsg = await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: 'USER',
      content: input.message,
      mode: 'RULE', // overwritten below; user rows ignore this value in FE.
    },
  });
  void userMsg;

  // 2) Decide mode + retrieve context.
  const ctx = await tryRetrieveContext(input.message);
  const useRag =
    ctx.chunks.length > 0 &&
    ctx.chunks[0]!.similarity >= getSimilarityThreshold();

  let response: string;
  let mode: ChatModeDecision;
  let sources: ChatSource[] = [];
  let actions: ChatAction[] = [];
  let llmModel: string | null = null;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let toolCallsLog: unknown = null;
  let toolResultsLog: unknown = null;

  if (useRag) {
    const ragOut = await runRagPipeline(input, ctx.chunks, session.id);
    response = ragOut.response;
    mode = 'rag';
    sources = ragOut.sources;
    actions = ragOut.actions;
    llmModel = ragOut.model ?? null;
    tokensIn = ragOut.tokensIn ?? null;
    tokensOut = ragOut.tokensOut ?? null;
    toolCallsLog = ragOut.toolCallsLog ?? null;
    toolResultsLog = ragOut.toolResultsLog ?? null;
  } else {
    const ruled = matchRule(input.message);
    response = ruled.response;
    mode = 'rule';
    sources = [];
    actions = ruled.actions;
  }

  // 3) Persist assistant message + bump session.updatedAt.
  const assistantMsg = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: response,
        mode: mode === 'rag' ? 'RAG' : 'RULE',
        tokensIn: tokensIn ?? undefined,
        tokensOut: tokensOut ?? undefined,
        model: llmModel ?? undefined,
        toolCalls: toolCallsLog as Prisma.InputJsonValue | undefined,
        // Stash sources + actions inside toolResults so GET sessions/[id]
        // can faithfully reconstruct them (the schema has no first-class
        // columns for them).
        toolResults: serializeAssistantMeta({
          sources,
          actions,
          tools: toolResultsLog,
        }),
      },
    });
    await tx.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });
    return created;
  });

  return {
    sessionId: session.id,
    messageId: assistantMsg.id,
    response,
    mode,
    sources: sources.length ? sources : undefined,
    actions: actions.length ? actions : undefined,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Session resolution
// ────────────────────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  userId: string;
  title: string | null;
}

async function ensureSession(
  userId: string,
  sessionId: string | undefined,
  firstMessage: string,
): Promise<SessionRow> {
  if (sessionId) {
    const existing = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, title: true },
    });
    if (!existing || existing.userId !== userId) {
      // Throw a tagged error that the route translates to 404.
      throw new SessionNotFoundError();
    }
    return existing;
  }
  const created = await prisma.chatSession.create({
    data: {
      userId,
      title: firstMessage.trim().slice(0, 40) || null,
    },
    select: { id: true, userId: true, title: true },
  });
  return created;
}

export class SessionNotFoundError extends Error {
  constructor() {
    super('chat session not found');
    this.name = 'SessionNotFoundError';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Retrieval
// ────────────────────────────────────────────────────────────────────────────

interface RetrieveOutcome {
  chunks: RetrievedChunk[];
  embedding: number[] | null;
}

async function tryRetrieveContext(message: string): Promise<RetrieveOutcome> {
  const cfg = getEmbedderConfig();
  if (!cfg) return { chunks: [], embedding: null };
  const vec = await embed(message);
  if (!vec) return { chunks: [], embedding: null };
  const chunks = await retrieveChunks(vec, 4);
  return { chunks, embedding: vec };
}

// ────────────────────────────────────────────────────────────────────────────
// RAG pipeline
// ────────────────────────────────────────────────────────────────────────────

interface RagOutput {
  response: string;
  sources: ChatSource[];
  actions: ChatAction[];
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  toolCallsLog?: unknown;
  toolResultsLog?: unknown;
}

async function runRagPipeline(
  input: OrchestratorInput,
  chunks: RetrievedChunk[],
  sessionId: string,
): Promise<RagOutput> {
  const sources: ChatSource[] = chunks.map((c) => ({
    chunkId: c.chunkId,
    source: c.source,
    title: c.title,
    similarity: round3(c.similarity),
  }));

  const llmCfg = getLlmConfig();
  if (!llmCfg) {
    // Template fallback — no LLM, but we have a relevant chunk.
    return {
      response: composeTemplateAnswer(chunks, input.message),
      sources,
      actions: [],
    };
  }

  // Recent history for the LLM context (oldest → newest excluding the user
  // message we just inserted, since we'll prepend it manually).
  const history = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY_TURNS * 2,
    select: { role: true, content: true },
  });
  history.reverse();

  const systemPrompt = buildSystemPrompt(chunks);
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((h) => ({ role: roleToLlm(h.role), content: h.content })),
  ];

  let result = await generate({
    messages,
    tools: LLM_TOOL_DEFINITIONS,
    toolChoice: 'auto',
    temperature: 0.3,
    maxTokens: 800,
  });
  if (!result) {
    // LLM endpoint unreachable — degrade to template answer.
    return {
      response: composeTemplateAnswer(chunks, input.message),
      sources,
      actions: [],
    };
  }

  const toolResultsLog: ToolResult[] = [];
  // Single round of tool execution.
  if (result.toolCalls.length > 0) {
    const assistantToolMsg: LlmMessage = {
      role: 'assistant',
      content: result.text || null,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
      })),
    };
    messages.push(assistantToolMsg);

    for (const tc of result.toolCalls) {
      const toolName = tc.name as ChatToolName;
      const r = await executeTool(toolName, tc.arguments, input.user);
      toolResultsLog.push(r);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.name,
        content: JSON.stringify(r),
      });
    }

    // Second pass — let the LLM compose the user-facing answer.
    const second = await generate({
      messages,
      // Disable tools on the recap pass so we don't loop.
      toolChoice: 'none',
      temperature: 0.3,
      maxTokens: 800,
    });
    if (second) result = second;
  }

  const actions = deriveActionsFromTools(toolResultsLog);

  return {
    response: result.text.trim() || composeTemplateAnswer(chunks, input.message),
    sources,
    actions,
    model: result.model,
    tokensIn: result.usage?.promptTokens,
    tokensOut: result.usage?.completionTokens,
    toolCallsLog: result.toolCalls.length ? result.toolCalls : null,
    toolResultsLog: toolResultsLog.length ? toolResultsLog : null,
  };
}

function buildSystemPrompt(chunks: RetrievedChunk[]): string {
  const ctx = chunks
    .map((c, i) => `[${i + 1}] (${c.source} · ${c.title})\n${c.content}`)
    .join('\n\n---\n\n');
  return `당신은 동국씨엠 도면관리시스템의 사내 AI 도우미입니다.
한국어로, 친절하고 간결하게 답하세요. 답에 확실하지 않으면 "정확하지 않을 수 있어요" 같은 안전 어휘를 사용합니다.
검색된 매뉴얼 청크가 답변과 관련 있을 때만 인용하고, 관련 없으면 일반적인 안내를 우선하세요.
필요하면 제공된 함수(도구)를 호출해 사용자의 컨텍스트(검색/결재함/활동)를 가져와서 답에 반영하세요.

[검색된 컨텍스트]
${ctx}`;
}

function composeTemplateAnswer(chunks: RetrievedChunk[], message: string): string {
  void message;
  const top = chunks[0];
  if (!top) {
    return '관련된 내용을 찾지 못했어요. 다른 키워드로 다시 물어봐 주세요.';
  }
  // Trim to keep the panel readable.
  const excerpt = top.content.length > 600 ? `${top.content.slice(0, 600)}…` : top.content;
  return `매뉴얼에서 가장 관련 있는 내용을 찾아왔어요.\n\n**${top.title}**\n\n${excerpt}\n\n_(출처: ${top.source})_`;
}

function deriveActionsFromTools(results: ToolResult[]): ChatAction[] {
  const actions: ChatAction[] = [];
  for (const r of results) {
    if (!r.ok) continue;
    if (r.toolName === 'search_drawings') {
      const data = r.data as { items?: Array<{ id: string; href?: string }> } | undefined;
      const first = data?.items?.[0];
      if (first?.href) {
        actions.push({ label: '첫 결과 열기', kind: 'navigate', href: first.href });
      }
      actions.push({ label: '검색 페이지 열기', kind: 'navigate', href: '/search' });
    } else if (r.toolName === 'get_drawing') {
      const data = r.data as { href?: string } | undefined;
      if (data?.href) {
        actions.push({ label: '도면 상세 열기', kind: 'navigate', href: data.href });
      }
    } else if (r.toolName === 'list_my_approvals') {
      actions.push({ label: '결재함 열기', kind: 'navigate', href: '/approvals' });
    } else if (r.toolName === 'get_recent_activity') {
      const data = r.data as { object?: { id?: string } } | undefined;
      if (data?.object?.id) {
        actions.push({
          label: '도면 활동 보기',
          kind: 'navigate',
          href: `/objects/${data.object.id}`,
        });
      }
    }
    // get_help has no obvious action chip.
  }
  // De-dupe on (kind, href).
  const seen = new Set<string>();
  return actions.filter((a) => {
    const key = `${a.kind}|${a.href ?? ''}|${a.paletteQuery ?? ''}|${a.toolName ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function roleToLlm(role: PrismaChatRole): LlmMessage['role'] {
  switch (role) {
    case 'USER':
      return 'user';
    case 'ASSISTANT':
      return 'assistant';
    case 'SYSTEM':
      return 'system';
    case 'TOOL':
      return 'tool';
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

interface AssistantMeta {
  sources: ChatSource[];
  actions: ChatAction[];
  tools?: unknown;
}

function serializeAssistantMeta(meta: AssistantMeta): Prisma.InputJsonValue {
  // Always returns an object, never undefined, so the JSON column is
  // populated and GET /chat/sessions/[id] can read sources/actions back.
  const out: Record<string, unknown> = {
    sources: meta.sources,
    actions: meta.actions,
  };
  if (meta.tools !== undefined && meta.tools !== null) {
    out.tools = meta.tools;
  }
  return out as Prisma.InputJsonValue;
}

/** Inverse of `serializeAssistantMeta`, used by GET /chat/sessions/[id]. */
export function deserializeAssistantMeta(raw: unknown): {
  sources: ChatSource[];
  actions: ChatAction[];
} {
  if (!raw || typeof raw !== 'object') return { sources: [], actions: [] };
  const root = raw as { sources?: unknown; actions?: unknown };
  const sources = Array.isArray(root.sources) ? (root.sources as ChatSource[]) : [];
  const actions = Array.isArray(root.actions) ? (root.actions as ChatAction[]) : [];
  return { sources, actions };
}
