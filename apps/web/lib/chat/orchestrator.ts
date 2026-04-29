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

import { randomUUID } from 'node:crypto';
import type { ChatRole as PrismaChatRole, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
  ChatAction,
  ChatSource,
  ChatModeDecision,
  ChatStreamEvent,
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
  await persistUserMessage(session.id, input.message);

  const composed = await composeAssistantTurn(input, session.id);

  // Persist assistant message + bump session.updatedAt in a single transaction.
  const assistantMsg = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: composed.response,
        mode: composed.mode === 'rag' ? 'RAG' : 'RULE',
        tokensIn: composed.tokensIn ?? undefined,
        tokensOut: composed.tokensOut ?? undefined,
        model: composed.llmModel ?? undefined,
        toolCalls: composed.toolCallsLog as Prisma.InputJsonValue | undefined,
        // Stash sources + actions inside toolResults so GET sessions/[id]
        // can faithfully reconstruct them (the schema has no first-class
        // columns for them).
        toolResults: serializeAssistantMeta({
          sources: composed.sources,
          actions: composed.actions,
          tools: composed.toolResultsLog,
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
    response: composed.response,
    mode: composed.mode,
    sources: composed.sources.length ? composed.sources : undefined,
    actions: composed.actions.length ? composed.actions : undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// R36-polish — Streaming variant.
//
// Yields ChatStreamEvent in contract §2.2 order: meta → delta* → sources?
// → actions? → done. Errors mid-pipeline emit a single `error` then `done`.
// The assistant ChatMessage is INSERTed just before `done` with `id =
// messageId` so the meta event's id matches the persisted row.
// ──────────────────────────────────────────────────────────────────────────

const DELTA_INTERVAL_MS = 200; // 인위 sleep — UX 위해 200ms 간격 발사.
const DELTA_MIN_CHARS = 8;
const DELTA_MAX_CHARS = 30;

export async function* handleChatTurnStream(
  input: OrchestratorInput,
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  // Phase A — session ensure + user message persistence. Errors here surface
  // as SessionNotFoundError (route translates to a `error` event).
  const session = await ensureSession(input.user.id, input.sessionId, input.message);
  await persistUserMessage(session.id, input.message);

  // Pre-generate the assistant messageId so meta can include it. Prisma 5
  // accepts an explicit `id` and skips the cuid default.
  const messageId = randomUUID();

  // Phase B — retrieval + compose. We don't yield `meta` until the mode is
  // decided, because the meta event must declare RAG vs RULE up-front (FE
  // uses it to pick the badge color). Retrieval is the slow step; this is
  // the only delay before the first emission.
  let composed: ComposedTurn;
  try {
    composed = await composeAssistantTurn(input, session.id);
  } catch (err) {
    console.error('[chat/stream] compose failed', err);
    yield { type: 'error', code: 'E_INTERNAL', message: '챗봇 응답 생성에 실패했습니다.' };
    yield { type: 'done' };
    return;
  }

  // Phase C — meta. First event of the stream.
  yield {
    type: 'meta',
    sessionId: session.id,
    messageId,
    mode: composed.mode,
  };

  // Phase D — delta(s). RULE mode is short text; emit in a single chunk.
  // RAG mode (which may be multi-paragraph) is split into 8~30 char chunks
  // with a 200ms gap to give the FE a typing effect.
  const text = composed.response;
  if (composed.mode === 'rule' || text.length <= DELTA_MAX_CHARS) {
    if (text.length > 0) {
      yield { type: 'delta', text };
    }
  } else {
    const chunks = splitForDelta(text);
    for (let i = 0; i < chunks.length; i++) {
      yield { type: 'delta', text: chunks[i]! };
      if (i < chunks.length - 1) {
        await sleep(DELTA_INTERVAL_MS);
      }
    }
  }

  // Phase E — sources (RAG-only, non-empty).
  if (composed.sources.length > 0) {
    yield { type: 'sources', sources: composed.sources };
  }

  // Phase F — actions.
  if (composed.actions.length > 0) {
    yield { type: 'actions', actions: composed.actions };
  }

  // Phase G — persist assistant message. Best-effort: if the DB write fails,
  // we still close out the stream cleanly so the FE renders what it has. The
  // user's own message is already persisted above.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.chatMessage.create({
        data: {
          id: messageId,
          sessionId: session.id,
          role: 'ASSISTANT',
          content: composed.response,
          mode: composed.mode === 'rag' ? 'RAG' : 'RULE',
          tokensIn: composed.tokensIn ?? undefined,
          tokensOut: composed.tokensOut ?? undefined,
          model: composed.llmModel ?? undefined,
          toolCalls: composed.toolCallsLog as Prisma.InputJsonValue | undefined,
          toolResults: serializeAssistantMeta({
            sources: composed.sources,
            actions: composed.actions,
            tools: composed.toolResultsLog,
          }),
        },
      });
      await tx.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      });
    });
  } catch (err) {
    console.error('[chat/stream] persistence failed', err);
    // Don't surface to user — they already saw the answer.
  }

  // Phase H — done.
  yield { type: 'done' };
}

// ──────────────────────────────────────────────────────────────────────────
// Shared helpers between stream and non-stream paths.
// ──────────────────────────────────────────────────────────────────────────

interface ComposedTurn {
  response: string;
  mode: ChatModeDecision;
  sources: ChatSource[];
  actions: ChatAction[];
  llmModel: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  toolCallsLog: unknown;
  toolResultsLog: unknown;
}

async function persistUserMessage(sessionId: string, message: string): Promise<void> {
  // Insert the user row up front so a crash mid-pipeline still leaves a
  // record of what they typed.
  await prisma.chatMessage.create({
    data: {
      sessionId,
      role: 'USER',
      content: message,
      mode: 'RULE', // overwritten on assistant turn; user rows ignore this in FE.
    },
  });
}

async function composeAssistantTurn(
  input: OrchestratorInput,
  sessionId: string,
): Promise<ComposedTurn> {
  const ctx = await tryRetrieveContext(input.message);
  const useRag =
    ctx.chunks.length > 0 &&
    ctx.chunks[0]!.similarity >= getSimilarityThreshold();

  if (useRag) {
    const ragOut = await runRagPipeline(input, ctx.chunks, sessionId);
    return {
      response: ragOut.response,
      mode: 'rag',
      sources: ragOut.sources,
      actions: ragOut.actions,
      llmModel: ragOut.model ?? null,
      tokensIn: ragOut.tokensIn ?? null,
      tokensOut: ragOut.tokensOut ?? null,
      toolCallsLog: ragOut.toolCallsLog ?? null,
      toolResultsLog: ragOut.toolResultsLog ?? null,
    };
  }
  const ruled = matchRule(input.message);
  return {
    response: ruled.response,
    mode: 'rule',
    sources: [],
    actions: ruled.actions,
    llmModel: null,
    tokensIn: null,
    tokensOut: null,
    toolCallsLog: null,
    toolResultsLog: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Split a Korean/English mixed answer into 8~30 char chunks for streaming.
 * We tokenize on whitespace + sentence-terminators (`.!?。`) to keep word
 * boundaries clean, then greedily concatenate tokens up to DELTA_MAX_CHARS.
 * If the very first token already exceeds DELTA_MAX_CHARS (e.g. a code
 * block run-on), we still emit it as a single chunk — better than slicing
 * mid-grapheme.
 */
export function splitForDelta(text: string): string[] {
  if (text.length === 0) return [];
  // Capture the separators so we don't lose spacing/punctuation.
  const tokens = text.split(/(\s+|[.!?。]+)/u).filter((t) => t.length > 0);
  if (tokens.length === 0) return [text];
  const out: string[] = [];
  let buf = '';
  for (const tok of tokens) {
    if (buf.length === 0) {
      buf = tok;
      continue;
    }
    if (buf.length + tok.length > DELTA_MAX_CHARS && buf.length >= DELTA_MIN_CHARS) {
      out.push(buf);
      buf = tok;
    } else {
      buf += tok;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
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
  const sources: ChatSource[] = chunks.map(toChatSource);

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

// R36-polish — RetrievedChunk → ChatSource 정규화. 본문 600자 cap + trailing
// whitespace trim. RULE 모드는 sources가 빈 배열이라 호출되지 않는다.
const EXCERPT_MAX = 600;
function toChatSource(c: RetrievedChunk): ChatSource {
  const raw = typeof c.content === 'string' ? c.content : '';
  const cap = raw.length > EXCERPT_MAX ? raw.slice(0, EXCERPT_MAX) : raw;
  const excerpt = cap.replace(/\s+$/u, '');
  return {
    chunkId: c.chunkId,
    source: c.source,
    title: c.title,
    similarity: round3(c.similarity),
    ...(excerpt.length > 0 ? { excerpt } : {}),
  };
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
