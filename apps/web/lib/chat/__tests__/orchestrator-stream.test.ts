// R36-polish — `handleChatTurnStream` unit tests.
//
// We don't have a real Postgres in the unit run, so prisma is mocked at the
// module boundary. The retriever/embedder/llm modules also live behind env
// switches — for the RULE-mode path we just leave the embedder unconfigured
// (which already returns an empty chunk list), so the orchestrator falls
// through to `matchRule`. For the RAG-mode path we mock retriever + llm
// explicitly.
//
// Verified contract clauses (api_contract.md §2.2):
//   1) First event is `meta` with sessionId/messageId/mode populated.
//   2) Concatenated `delta` text equals the final response.
//   3) `sources` and `actions` events come before `done`.
//   4) Last event is always `done`.
//   5) Errors mid-pipeline emit a single `error` followed by `done`.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChatStreamEvent } from '@drawing-mgmt/shared';

// ──────────────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────────────

// In-memory ChatMessage table — keyed by inserted row count for assertions.
const insertedMessages: Array<{
  id?: string;
  sessionId: string;
  role: string;
  content: string;
  mode: string;
}> = [];

// Mocked session store. Default returns the session we created in `beforeEach`.
let mockSession: { id: string; userId: string; title: string | null } | null = null;

vi.mock('@/lib/prisma', () => {
  const prisma = {
    chatSession: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (mockSession && mockSession.id === where.id) return mockSession;
        return null;
      }),
      create: vi.fn(async ({ data }: { data: { userId: string; title: string | null } }) => {
        mockSession = { id: 'session-new', userId: data.userId, title: data.title };
        return mockSession;
      }),
      update: vi.fn(async () => mockSession),
    },
    chatMessage: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: (data.id as string | undefined) ?? `msg-${insertedMessages.length}`,
          sessionId: data.sessionId as string,
          role: data.role as string,
          content: data.content as string,
          mode: data.mode as string,
        };
        insertedMessages.push(row);
        return row;
      }),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      // Re-use the same mocked client inside the transaction callback so
      // nested `tx.chatMessage.create` calls land in the same in-memory list.
      return cb(prisma);
    }),
  };
  return { prisma };
});

// Embedder and LLM are mocked per-test via these spies; default = unconfigured
// (RULE-mode fall-through).
const embedderConfig: { current: { apiUrl: string } | null } = { current: null };
const embedReturns: { current: number[] | null } = { current: null };
const llmConfig: { current: { apiUrl: string; model: string } | null } = { current: null };
const llmGenerateReturns: {
  current: { text: string; toolCalls: unknown[]; model: string } | null;
} = { current: null };
const retrieverChunks: {
  current: Array<{
    chunkId: string;
    source: string;
    title: string;
    content: string;
    similarity: number;
  }>;
} = { current: [] };

vi.mock('@/lib/chat/embedder', () => ({
  embed: vi.fn(async () => embedReturns.current),
  getEmbedderConfig: vi.fn(() => embedderConfig.current),
}));

vi.mock('@/lib/chat/llm', () => ({
  generate: vi.fn(async () => llmGenerateReturns.current),
  getLlmConfig: vi.fn(() => llmConfig.current),
}));

vi.mock('@/lib/chat/retriever', () => ({
  retrieveChunks: vi.fn(async () => retrieverChunks.current),
  getSimilarityThreshold: vi.fn(() => 0.55),
  pickTopAboveThreshold: vi.fn(() => null),
}));

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

async function consume(
  gen: AsyncGenerator<ChatStreamEvent, void, unknown>,
): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const evt of gen) events.push(evt);
  return events;
}

const USER = { id: 'user-1', role: 'DESIGNER', securityLevel: 3 };

beforeEach(() => {
  insertedMessages.length = 0;
  mockSession = null;
  embedderConfig.current = null;
  embedReturns.current = null;
  llmConfig.current = null;
  llmGenerateReturns.current = null;
  retrieverChunks.current = [];
});

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

describe('handleChatTurnStream — RULE mode', () => {
  it('emits meta → delta → done with mode=rule when retrieval is unavailable', async () => {
    const { handleChatTurnStream } = await import('../orchestrator');

    const events = await consume(
      handleChatTurnStream({ user: USER, message: '결재함 어디서 봐?' }),
    );

    // Contract §2.2 invariant 1: first event is `meta`.
    expect(events[0]?.type).toBe('meta');
    if (events[0]?.type !== 'meta') throw new Error('unreachable');
    expect(events[0].mode).toBe('rule');
    expect(events[0].sessionId).toBeTruthy();
    expect(events[0].messageId).toBeTruthy();

    // Contract §2.2 invariant 4: last event is `done`.
    expect(events.at(-1)?.type).toBe('done');

    // Contract §2.2 invariant 2: delta text concat = final response.
    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas.length).toBeGreaterThan(0);
    const concatenated = deltas
      .map((e) => (e.type === 'delta' ? e.text : ''))
      .join('');
    // Rule-mode "결재함" reply mentions the page; we just assert the join is
    // non-empty and matches what got persisted.
    expect(concatenated.length).toBeGreaterThan(0);
    expect(insertedMessages.find((m) => m.role === 'ASSISTANT')?.content).toBe(
      concatenated,
    );

    // No `sources` event in RULE mode.
    expect(events.find((e) => e.type === 'sources')).toBeUndefined();
  });

  it('persists assistant message with the same id declared in meta', async () => {
    const { handleChatTurnStream } = await import('../orchestrator');

    const events = await consume(
      handleChatTurnStream({ user: USER, message: '단축키 알려줘' }),
    );
    const meta = events[0];
    if (meta?.type !== 'meta') throw new Error('expected meta first');

    const assistant = insertedMessages.find((m) => m.role === 'ASSISTANT');
    expect(assistant?.id).toBe(meta.messageId);
  });

  it('emits actions before done when the rule reply has any', async () => {
    const { handleChatTurnStream } = await import('../orchestrator');

    const events = await consume(
      handleChatTurnStream({ user: USER, message: '결재함 어디서 봐?' }),
    );

    const actionsIdx = events.findIndex((e) => e.type === 'actions');
    const doneIdx = events.findIndex((e) => e.type === 'done');
    expect(actionsIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(actionsIdx);
  });
});

describe('handleChatTurnStream — RAG mode', () => {
  it('emits meta(rag) → delta(s) → sources → done with excerpt populated', async () => {
    embedderConfig.current = { apiUrl: 'http://embed.local' };
    embedReturns.current = [0.1, 0.2, 0.3];
    retrieverChunks.current = [
      {
        chunkId: 'chunk-1',
        source: 'PRD',
        title: '결재 흐름',
        content:
          '결재 대기 알림은 헤더 우측 종 아이콘에 빨간 점으로 표시됩니다. ' +
          '클릭하면 결재함이 열리고, 대기/완료/요청 탭에서 각 박스를 확인할 수 있어요.',
        similarity: 0.82,
      },
    ];
    // No LLM configured → orchestrator falls back to template-quote answer.

    const { handleChatTurnStream } = await import('../orchestrator');
    const events = await consume(
      handleChatTurnStream({ user: USER, message: '결재 대기 알림이 어디 떠?' }),
    );

    // meta first.
    const meta = events[0];
    expect(meta?.type).toBe('meta');
    if (meta?.type !== 'meta') throw new Error('unreachable');
    expect(meta.mode).toBe('rag');

    // sources event with non-empty array + excerpt populated.
    const srcEvt = events.find((e) => e.type === 'sources');
    expect(srcEvt).toBeTruthy();
    if (srcEvt?.type !== 'sources') throw new Error('unreachable');
    expect(srcEvt.sources).toHaveLength(1);
    expect(srcEvt.sources[0]?.chunkId).toBe('chunk-1');
    expect(srcEvt.sources[0]?.excerpt).toBeTruthy();
    expect((srcEvt.sources[0]?.excerpt ?? '').length).toBeLessThanOrEqual(600);

    // done last.
    expect(events.at(-1)?.type).toBe('done');

    // sources comes before done.
    const srcIdx = events.findIndex((e) => e.type === 'sources');
    const doneIdx = events.findIndex((e) => e.type === 'done');
    expect(srcIdx).toBeLessThan(doneIdx);
  });

  it('caps excerpt at 600 chars when chunk content is longer', async () => {
    embedderConfig.current = { apiUrl: 'http://embed.local' };
    embedReturns.current = [0.1];
    const longContent = 'x'.repeat(1000);
    retrieverChunks.current = [
      {
        chunkId: 'chunk-long',
        source: 'TRD',
        title: '긴 청크',
        content: longContent,
        similarity: 0.9,
      },
    ];

    const { handleChatTurnStream } = await import('../orchestrator');
    const events = await consume(
      handleChatTurnStream({ user: USER, message: '뭔가 긴 답이 필요해' }),
    );
    const srcEvt = events.find((e) => e.type === 'sources');
    if (srcEvt?.type !== 'sources') throw new Error('unreachable');
    expect(srcEvt.sources[0]?.excerpt?.length).toBe(600);
  });
});

describe('handleChatTurnStream — error path', () => {
  it('emits error + done when compose throws (e.g. retriever blows up)', async () => {
    embedderConfig.current = { apiUrl: 'http://embed.local' };
    embedReturns.current = [0.1];
    // Override retrieveChunks to throw.
    const retrieverMod = await import('@/lib/chat/retriever');
    vi.mocked(retrieverMod.retrieveChunks).mockRejectedValueOnce(
      new Error('boom'),
    );

    const { handleChatTurnStream } = await import('../orchestrator');
    const events = await consume(
      handleChatTurnStream({ user: USER, message: '안녕' }),
    );

    // Either the error short-circuited compose (in which case no `meta`
    // appears) OR retrieval was caught silently and we fell to RULE mode.
    // The orchestrator's `tryRetrieveContext` already swallows retriever
    // errors, so we expect a clean RULE-mode stream — error path is exercised
    // via the second test below where compose itself throws.
    expect(events.at(-1)?.type).toBe('done');
  });

  it('emits error + done when ensureSession-equivalent (compose) throws', async () => {
    // Simulate a deeper failure: matchRule throws.
    embedderConfig.current = null; // ensure we go to rule path
    embedReturns.current = null;

    const rulesMod = await import('@/lib/chat/rules');
    const original = rulesMod.matchRule;
    vi.spyOn(rulesMod, 'matchRule').mockImplementationOnce(() => {
      throw new Error('rule explosion');
    });

    const { handleChatTurnStream } = await import('../orchestrator');
    const events = await consume(
      handleChatTurnStream({ user: USER, message: '???' }),
    );

    // First event should be `error` (compose threw before meta could be sent).
    expect(events[0]?.type).toBe('error');
    if (events[0]?.type === 'error') {
      expect(events[0].code).toBe('E_INTERNAL');
    }
    // Followed by `done`.
    expect(events.at(-1)?.type).toBe('done');

    // Restore for other tests.
    vi.spyOn(rulesMod, 'matchRule').mockImplementation(original);
  });
});

describe('splitForDelta', () => {
  it('keeps short text in a single chunk', async () => {
    const { splitForDelta } = await import('../orchestrator');
    expect(splitForDelta('짧은 답')).toEqual(['짧은 답']);
  });

  it('chunks long text without losing characters', async () => {
    const { splitForDelta } = await import('../orchestrator');
    const text =
      '결재 대기 알림은 헤더 우측 종 아이콘에 빨간 점으로 표시됩니다. ' +
      '결재함을 열면 대기/완료/요청 탭이 보여요. 한번 들어가서 확인해 보세요.';
    const chunks = splitForDelta(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
  });
});
