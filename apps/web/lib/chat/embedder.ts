// R36 — Embedding adapter.
//
// Calls an OpenAI-compatible `/embeddings` endpoint. The shape mirrors the
// public OpenAI API so self-hosted gateways (vLLM, Ollama OpenAI-compat,
// LiteLLM) work without code changes.
//
// `embed()` returns `null` when the endpoint isn't configured. Callers
// (retriever, build-corpus script, orchestrator) interpret null as
// "embedding unavailable → fall back to rule mode" and never throw.
//
// Why direct fetch (no SDK):
//   - Contract §5 forbids paid SDKs and the only Anthropic-style channel is
//     the LLM path (lib/chat/llm.ts) — embeddings stay generic.
//   - Avoids pulling another dep into the API route bundle.
//
// Network errors are swallowed and logged; the caller keeps going in rule
// mode rather than 500-ing on a transient embedding gateway hiccup.

const DEFAULT_TIMEOUT_MS = 8_000;

export interface EmbedderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Override timeout (ms). Defaults to 8 000. */
  timeoutMs?: number;
}

/** Read the active config from env. Returns null when any required var is missing. */
export function getEmbedderConfig(): EmbedderConfig | null {
  const baseUrl = process.env.CHAT_EMBEDDING_BASE_URL?.trim();
  const apiKey = process.env.CHAT_EMBEDDING_API_KEY?.trim() ?? '';
  const model = process.env.CHAT_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
  if (!baseUrl) return null;
  return { baseUrl, apiKey, model };
}

/**
 * Embed a single string. Returns the 1536-d vector (OpenAI text-embedding-3-small
 * default) or null on any failure (config missing, HTTP error, malformed body,
 * abort).
 *
 * The vector dimension is NOT validated here — the build-corpus script and
 * retriever pgvector column both assume 1536, and a mismatched gateway would
 * surface as a Postgres `vector` cast error at INSERT time.
 */
export async function embed(text: string, cfgOverride?: EmbedderConfig): Promise<number[] | null> {
  const cfg = cfgOverride ?? getEmbedderConfig();
  if (!cfg) return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  const url = joinUrl(cfg.baseUrl, '/embeddings');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: cfg.model, input: trimmed }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[chat/embedder] HTTP ${res.status} ${res.statusText} from ${url}`);
      return null;
    }
    const json: unknown = await res.json();
    const vec = extractEmbedding(json);
    if (!vec) {
      console.warn('[chat/embedder] response missing data[0].embedding');
      return null;
    }
    return vec;
  } catch (err) {
    console.warn('[chat/embedder] failed', (err as Error)?.message ?? err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Cheap reachability ping for `/api/v1/chat/health`. */
export async function pingEmbedding(): Promise<boolean> {
  const cfg = getEmbedderConfig();
  if (!cfg) return false;
  // Minimal token use; we only need a 200.
  const v = await embed('ping', { ...cfg, timeoutMs: 3_000 });
  return v !== null;
}

function extractEmbedding(payload: unknown): number[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as { data?: Array<{ embedding?: unknown }> };
  const first = root.data?.[0]?.embedding;
  if (!Array.isArray(first)) return null;
  if (!first.every((n) => typeof n === 'number')) return null;
  return first as number[];
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`);
}
