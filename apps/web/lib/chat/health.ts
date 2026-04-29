// R36 — Chat health probe.
//
// Combines:
//   - pgvector extension presence (DB)
//   - LLM endpoint reachability
//   - Embedding endpoint reachability
//
// Cached in-process for 30s — `/chat/health` is polled from the FE chat
// panel + admin diagnostics page, so we don't want to ping the LLM gateway
// on every request.

import type { ChatHealthStatus } from '@drawing-mgmt/shared';
import { prisma } from '@/lib/prisma';
import { pingLlm, getLlmConfig } from './llm';
import { pingEmbedding, getEmbedderConfig } from './embedder';

const CACHE_TTL_MS = 30_000;

let cached: { value: ChatHealthStatus; expiresAt: number } | null = null;

/**
 * Reset the cached health value. Used by tests; rarely needed in prod since
 * the cache TTL is short.
 */
export function clearHealthCache(): void {
  cached = null;
}

export async function getChatHealth(): Promise<ChatHealthStatus> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const [pgvector, llmReachable, embeddingReachable] = await Promise.all([
    checkPgVector(),
    pingLlm(),
    pingEmbedding(),
  ]);

  const llmConfigured = !!getLlmConfig();
  const embeddingConfigured = !!getEmbedderConfig();

  const decision: 'rag' | 'rule' =
    pgvector && embeddingConfigured && embeddingReachable ? 'rag' : 'rule';

  const reason = composeReason({
    pgvector,
    llmConfigured,
    llmReachable,
    embeddingConfigured,
    embeddingReachable,
    decision,
  });

  const status: ChatHealthStatus = {
    pgvector,
    llmReachable,
    embeddingReachable,
    decision,
    reason,
    checkedAt: new Date(now).toISOString(),
  };
  cached = { value: status, expiresAt: now + CACHE_TTL_MS };
  return status;
}

async function checkPgVector(): Promise<boolean> {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT 1 AS ok FROM pg_extension WHERE extname = 'vector' LIMIT 1`,
    )) as Array<{ ok: number }>;
    return rows.length > 0;
  } catch (err) {
    console.warn('[chat/health] pgvector probe failed', (err as Error)?.message ?? err);
    return false;
  }
}

function composeReason(p: {
  pgvector: boolean;
  llmConfigured: boolean;
  llmReachable: boolean;
  embeddingConfigured: boolean;
  embeddingReachable: boolean;
  decision: 'rag' | 'rule';
}): string {
  const parts: string[] = [];
  if (!p.pgvector) parts.push('pgvector 미활성');
  if (!p.embeddingConfigured) parts.push('임베딩 endpoint 미설정');
  else if (!p.embeddingReachable) parts.push('임베딩 endpoint 응답 없음');
  if (!p.llmConfigured) parts.push('LLM endpoint 미설정');
  else if (!p.llmReachable) parts.push('LLM endpoint 응답 없음');

  if (parts.length === 0) return p.decision === 'rag' ? 'RAG 모드 정상' : '룰 모드';
  return `${parts.join(' · ')} → ${p.decision === 'rag' ? 'RAG' : '룰'} 모드`;
}
