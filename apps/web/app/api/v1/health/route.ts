// GET /api/v1/health — composite health check.
//
// Returns the status of each dependency plus the resolved chat mode.
// No auth required (used by uptime probes per TRD §10.3). No PII exposure.
//
// Mode selection (TRD §14.2):
//   rag  — PGVECTOR_ENABLED=true && ANTHROPIC_API_KEY set && reachable
//   rule — otherwise
//   Result is cached for 60 seconds to avoid hammering external APIs.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

interface HealthSnapshot {
  status: 'ok' | 'degraded' | 'down';
  db: 'ok' | 'down';
  redis: 'ok' | 'down' | 'na';
  llm: 'ok' | 'down' | 'disabled';
  mode: 'rag' | 'rule';
  timestamp: string;
}

interface CachedSnapshot {
  snapshot: HealthSnapshot;
  /** epoch ms */
  expiresAt: number;
}

// 1-minute mode cache per TRD §14.2.
let cache: CachedSnapshot | null = null;
const CACHE_TTL_MS = 60_000;

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return NextResponse.json(cache.snapshot);
  }

  const [db, redis, llm] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkLlm(),
  ]);

  const mode = chooseMode({
    pgvectorEnabled: process.env.PGVECTOR_ENABLED === 'true',
    chatModeEnv: process.env.CHAT_MODE ?? 'auto',
    llmStatus: llm,
  });

  const overall: HealthSnapshot['status'] =
    db === 'down' ? 'down' : llm === 'down' ? 'degraded' : 'ok';

  const snapshot: HealthSnapshot = {
    status: overall,
    db,
    redis,
    llm,
    mode,
    timestamp: new Date().toISOString(),
  };

  cache = { snapshot, expiresAt: now + CACHE_TTL_MS };

  return NextResponse.json(snapshot, {
    status: db === 'down' ? 503 : 200,
  });
}

async function checkDb(): Promise<'ok' | 'down'> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'down';
  }
}

async function checkRedis(): Promise<'ok' | 'down' | 'na'> {
  const url = process.env.REDIS_URL;
  if (!url) return 'na';
  // Lightweight check: dynamic import to avoid bundling ioredis on Edge.
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 1500,
      maxRetriesPerRequest: 1,
    });
    try {
      await client.connect();
      const pong = await client.ping();
      return pong === 'PONG' ? 'ok' : 'down';
    } finally {
      client.disconnect();
    }
  } catch {
    return 'down';
  }
}

async function checkLlm(): Promise<'ok' | 'down' | 'disabled'> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return 'disabled';
  // Cheapest reachability check — HEAD /v1/messages returns 405 if reachable
  // (POST-only endpoint). Anything 2xx/4xx counts as reachable; only network
  // failure or 5xx counts as down. We use a tight timeout so health endpoint
  // doesn't hang.
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'HEAD',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      signal: ctrl.signal,
    });
    return res.status >= 500 ? 'down' : 'ok';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timeout);
  }
}

interface ModeInputs {
  pgvectorEnabled: boolean;
  chatModeEnv: string; // 'auto' | 'rag' | 'rule'
  llmStatus: 'ok' | 'down' | 'disabled';
}

/**
 * Implements chooseMode logic per TRD §14.2.
 * Forced modes (`rule`/`rag`) win unless impossible.
 */
function chooseMode(inp: ModeInputs): 'rag' | 'rule' {
  if (inp.chatModeEnv === 'rule') return 'rule';
  if (inp.chatModeEnv === 'rag') {
    return inp.pgvectorEnabled && inp.llmStatus === 'ok' ? 'rag' : 'rule';
  }
  // auto
  if (inp.pgvectorEnabled && inp.llmStatus === 'ok') return 'rag';
  return 'rule';
}
