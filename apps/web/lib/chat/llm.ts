// R36 — LLM adapter.
//
// Calls an OpenAI-compatible `/chat/completions` endpoint. ENV-toggled. When
// not configured (`CHAT_LLM_BASE_URL` empty) `generate()` returns null and the
// orchestrator falls back to a template that quotes the top-1 RAG chunk
// directly, so the system stays useful without an LLM.
//
// Tool-calling is supported but optional: if the request includes `tools` and
// the model returns a `tool_calls` array we hand it back to the caller for
// execution; otherwise we just return the assistant text. The orchestrator
// decides whether to enable tools (rag mode) or not (rule mode).
//
// The shape mirrors OpenAI Chat Completions exactly so it works with vLLM,
// Ollama (`/v1/chat/completions`), LiteLLM, Together, etc. without code
// changes.

const DEFAULT_TIMEOUT_MS = 30_000;

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  // OpenAI-shaped tool calls. We pass through verbatim.
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface LlmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface LlmGenerateResult {
  /** Assistant message text. May be empty when only tool_calls were returned. */
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: unknown }>;
  /** Raw token usage if the gateway reports it (some compat servers omit). */
  usage?: { promptTokens?: number; completionTokens?: number };
  model: string;
}

export function getLlmConfig(): LlmConfig | null {
  const baseUrl = process.env.CHAT_LLM_BASE_URL?.trim();
  const apiKey = process.env.CHAT_LLM_API_KEY?.trim() ?? '';
  const model = process.env.CHAT_LLM_MODEL?.trim() || 'gpt-4o-mini';
  if (!baseUrl) return null;
  return { baseUrl, apiKey, model };
}

export interface GenerateOptions {
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  /** Force a specific tool name, leave undefined to let model choose. */
  toolChoice?: 'auto' | 'none';
  temperature?: number;
  maxTokens?: number;
}

/**
 * Issue a /chat/completions request. Returns null on:
 *   - missing config
 *   - HTTP non-2xx
 *   - malformed/empty `choices`
 *   - timeout/abort
 *
 * Errors are logged but never thrown — the orchestrator falls back to template
 * mode rather than failing the user-facing request.
 */
export async function generate(opts: GenerateOptions, cfgOverride?: LlmConfig): Promise<LlmGenerateResult | null> {
  const cfg = cfgOverride ?? getLlmConfig();
  if (!cfg) return null;

  const url = joinUrl(cfg.baseUrl, '/chat/completions');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 800,
    };
    if (opts.tools?.length) {
      body.tools = opts.tools;
      body.tool_choice = opts.toolChoice ?? 'auto';
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[chat/llm] HTTP ${res.status} ${res.statusText}`);
      return null;
    }
    const json: unknown = await res.json();
    return parseCompletion(json, cfg.model);
  } catch (err) {
    console.warn('[chat/llm] failed', (err as Error)?.message ?? err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Cheap reachability ping for /api/v1/chat/health. */
export async function pingLlm(): Promise<boolean> {
  const cfg = getLlmConfig();
  if (!cfg) return false;
  // 1-token completion to verify the gateway responds. Some servers reject
  // max_tokens<2; we use 8 to be safe.
  const result = await generate(
    {
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 8,
      temperature: 0,
    },
    { ...cfg, timeoutMs: 4_000 },
  );
  return result !== null;
}

function parseCompletion(payload: unknown, fallbackModel: string): LlmGenerateResult | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          type: 'function';
          function: { name: string; arguments: string };
        }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const msg = root.choices?.[0]?.message;
  if (!msg) return null;

  const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name ?? '',
    arguments: safeParseJson(tc.function?.arguments ?? ''),
  }));

  return {
    text: msg.content ?? '',
    toolCalls,
    usage: root.usage
      ? {
          promptTokens: root.usage.prompt_tokens,
          completionTokens: root.usage.completion_tokens,
        }
      : undefined,
    model: root.model ?? fallbackModel,
  };
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`);
}
