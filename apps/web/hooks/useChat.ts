'use client';

import * as React from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import type {
  ChatHealthStatus,
  ChatPostResponse,
  ChatSessionDetail,
  ChatSessionSummary,
  ChatStreamEvent,
  QuickAction,
} from '@/lib/chat-types';
import { api } from '@/lib/api-client';

/**
 * R36 — chat data hooks (R36-polish: NDJSON streaming added).
 *
 * Query key convention (§4 of frontend.md): `['chat', <resource>, ...filters]`.
 * Co-located here (not under apps/web/lib/queries) because the chat panel
 * is the only consumer; pulling in a page-level cache key registry would
 * be over-eager for a single feature.
 */

export const chatQueryKeys = {
  health: () => ['chat', 'health'] as const,
  quickActions: () => ['chat', 'quick-actions'] as const,
  sessions: () => ['chat', 'sessions'] as const,
  session: (id: string) => ['chat', 'session', id] as const,
};

/**
 * `GET /chat/health` — surfaces the badge shown in the panel header.
 * Cached 30s; the BE memoizes it 30s anyway and we don't want a poll loop.
 */
export function useChatHealth(enabled = true) {
  return useQuery<ChatHealthStatus>({
    queryKey: chatQueryKeys.health(),
    queryFn: () => api.get<ChatHealthStatus>('/api/v1/chat/health'),
    staleTime: 30 * 1000,
    enabled,
  });
}

/**
 * `GET /chat/quick-actions` — the chip strip + empty-state grid.
 * Long stale window (5min) since labels rarely change within a session.
 */
export function useQuickActions(enabled = true) {
  return useQuery<{ actions: QuickAction[] }>({
    queryKey: chatQueryKeys.quickActions(),
    queryFn: () => api.get<{ actions: QuickAction[] }>('/api/v1/chat/quick-actions'),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/**
 * `GET /chat/sessions` — sidebar history.
 */
export function useChatSessions(enabled = true) {
  return useQuery<{ sessions: ChatSessionSummary[] }>({
    queryKey: chatQueryKeys.sessions(),
    queryFn: () =>
      api.get<{ sessions: ChatSessionSummary[] }>('/api/v1/chat/sessions', {
        query: { limit: 20 },
      }),
    staleTime: 30 * 1000,
    enabled,
  });
}

/**
 * `GET /chat/sessions/[id]` — pull a session's messages when user clicks a row.
 */
export function useChatSession(id: string | undefined) {
  return useQuery<ChatSessionDetail>({
    queryKey: id ? chatQueryKeys.session(id) : ['chat', 'session', '__none__'],
    queryFn: () => api.get<ChatSessionDetail>(`/api/v1/chat/sessions/${id}`),
    enabled: Boolean(id),
    staleTime: 10 * 1000,
  });
}

/**
 * `DELETE /chat/sessions/[id]` — invalidates session list afterwards.
 */
export function useDeleteChatSession(): UseMutationResult<
  { ok: true },
  ApiError,
  string
> {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, ApiError, string>({
    mutationFn: (id) => api.delete<{ ok: true }>(`/api/v1/chat/sessions/${id}`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: chatQueryKeys.sessions() });
      qc.removeQueries({ queryKey: chatQueryKeys.session(id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Streaming send (R36-polish P1)
// ---------------------------------------------------------------------------

export type ChatPhase = 'idle' | 'thinking' | 'speaking' | 'error';

export interface ChatStreamCallbacks {
  /** Fires once at the start of the response with sessionId/messageId/mode. */
  onMeta: (meta: { sessionId: string; messageId: string; mode: 'rag' | 'rule' }) => void;
  /** Fires per delta — receives the cumulative concatenated text and the new chunk. */
  onDelta: (cumulative: string, chunk: string) => void;
  /** Fires zero or one time near the end. */
  onSources: (sources: import('@/lib/chat-types').ChatSource[]) => void;
  /** Fires zero or one time near the end. */
  onActions: (actions: import('@/lib/chat-types').ChatAction[]) => void;
  /**
   * Inline error event (BE surfaced) — `done` will follow shortly. The caller
   * should mark the turn errored and show retry surface.
   */
  onInlineError: (error: { code: string; message: string }) => void;
  /**
   * Network/HTTP error path (response not ok, parse failed, abort, etc.).
   * Mutually exclusive with `onInlineError` in normal flow.
   */
  onTransportError: (err: ApiError) => void;
  /** Fires once on `done` (or transport completion). */
  onDone: (cumulative: string) => void;
  /** Optional non-streaming fallback when the server didn't return ndjson. */
  onFallbackEnvelope?: (data: ChatPostResponse) => void;
}

interface SendStreamArgs {
  sessionId?: string;
  message: string;
  /** Receives the AbortController so the caller can cancel mid-stream. */
  registerAbort?: (ac: AbortController) => void;
}

/**
 * Read the body of a `Response` as line-delimited JSON, dispatching to the
 * callbacks. Buffers partial lines across chunks. Returns the cumulative
 * delta text on completion.
 */
async function readNdjson(
  response: Response,
  cb: ChatStreamCallbacks,
  signal?: AbortSignal,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    cb.onTransportError(
      new ApiError('Streaming not supported in this environment', { status: 0 }),
    );
    return '';
  }
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let cumulative = '';
  let inlineErrored = false;

  const dispatch = (line: string) => {
    if (!line) return;
    let evt: ChatStreamEvent;
    try {
      evt = JSON.parse(line) as ChatStreamEvent;
    } catch {
      // Malformed line — skip. (BE invariant says lines are valid JSON.)
      return;
    }
    switch (evt.type) {
      case 'meta':
        cb.onMeta({ sessionId: evt.sessionId, messageId: evt.messageId, mode: evt.mode });
        return;
      case 'delta':
        cumulative += evt.text;
        cb.onDelta(cumulative, evt.text);
        return;
      case 'sources':
        cb.onSources(evt.sources);
        return;
      case 'actions':
        cb.onActions(evt.actions);
        return;
      case 'error':
        inlineErrored = true;
        cb.onInlineError({ code: evt.code, message: evt.message });
        return;
      case 'done':
        cb.onDone(cumulative);
        return;
    }
  };

  try {
    while (true) {
      if (signal?.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* swallow */
        }
        break;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Drain whole lines.
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) dispatch(line);
        nl = buf.indexOf('\n');
      }
    }
    // Flush trailing partial (server may omit final \n).
    const tail = (buf + decoder.decode()).trim();
    if (tail) dispatch(tail);
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      // Caller cancelled — don't surface as error.
      return cumulative;
    }
    cb.onTransportError(
      new ApiError(
        err instanceof Error ? err.message : '스트림 읽기 실패',
        { status: 0 },
      ),
    );
    return cumulative;
  }
  // If the server closed cleanly without `done` and no inline error, treat as
  // an implicit done so the caller can finalize.
  if (!inlineErrored) {
    cb.onDone(cumulative);
  }
  return cumulative;
}

/**
 * Imperative streaming send. Owns its own AbortController; returns it via
 * `registerAbort` so the caller can cancel.
 *
 * The hook intentionally does **not** keep `phase` state for the network call
 * itself — the panel manages its own turn list. We only return a tiny
 * `phase` derived state convenience for the `<RobotAvatar>` glue.
 */
export function useChat() {
  const qc = useQueryClient();
  const [phase, setPhase] = React.useState<ChatPhase>('idle');
  const abortRef = React.useRef<AbortController | null>(null);

  // Cancel any in-flight stream when the panel unmounts.
  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const cancel = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
  }, []);

  const sendMessage = React.useCallback(
    async (
      args: SendStreamArgs,
      cb: ChatStreamCallbacks,
    ): Promise<void> => {
      // Cancel any prior in-flight call before we start a new one.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      args.registerAbort?.(ac);

      setPhase('thinking');

      let firstDeltaSeen = false;
      const wrapped: ChatStreamCallbacks = {
        ...cb,
        onDelta: (cumulative, chunk) => {
          if (!firstDeltaSeen) {
            firstDeltaSeen = true;
            setPhase('speaking');
          }
          cb.onDelta(cumulative, chunk);
        },
        onInlineError: (error) => {
          setPhase('error');
          cb.onInlineError(error);
        },
        onTransportError: (err) => {
          setPhase('error');
          cb.onTransportError(err);
        },
        onDone: (cumulative) => {
          // Reset to idle if not already errored.
          setPhase((p) => (p === 'error' ? 'error' : 'idle'));
          cb.onDone(cumulative);
        },
      };

      let response: Response;
      try {
        response = await fetch('/api/v1/chat', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/x-ndjson',
          },
          body: JSON.stringify({ sessionId: args.sessionId, message: args.message }),
          signal: ac.signal,
        });
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') {
          setPhase('idle');
          return;
        }
        wrapped.onTransportError(
          new ApiError(
            err instanceof Error ? err.message : '네트워크 오류',
            { status: 0 },
          ),
        );
        return;
      }

      if (!response.ok) {
        // Try envelope error parse.
        let code: string | undefined;
        let message = `Request failed (${response.status})`;
        let details: unknown;
        try {
          const text = await response.text();
          if (text) {
            const parsed = JSON.parse(text) as {
              error?: { code?: string; message?: string; details?: unknown };
            };
            code = parsed?.error?.code;
            if (parsed?.error?.message) message = parsed.error.message;
            details = parsed?.error?.details;
          }
        } catch {
          /* swallow — fall back to status-only error */
        }
        wrapped.onTransportError(
          new ApiError(message, { code, status: response.status, details }),
        );
        return;
      }

      const contentType = response.headers.get('content-type') ?? '';
      const isNdjson = /application\/x-ndjson/i.test(contentType);

      if (!isNdjson) {
        // Fallback: server returned the JSON envelope (Accept negotiation
        // might have been overridden — dev safety net).
        try {
          const text = await response.text();
          const parsed = text ? (JSON.parse(text) as { data?: ChatPostResponse } | ChatPostResponse) : undefined;
          const data: ChatPostResponse | undefined =
            parsed && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)
              ? (parsed as { data: ChatPostResponse }).data
              : (parsed as ChatPostResponse | undefined);
          if (!data) {
            wrapped.onTransportError(
              new ApiError('Empty response', { status: response.status }),
            );
            return;
          }
          // Synthesize the same callback sequence the stream would produce so
          // downstream UI stays consistent.
          wrapped.onMeta({
            sessionId: data.sessionId,
            messageId: data.messageId,
            mode: data.mode,
          });
          wrapped.onDelta(data.response, data.response);
          if (data.sources && data.sources.length) wrapped.onSources(data.sources);
          if (data.actions && data.actions.length) wrapped.onActions(data.actions);
          wrapped.onDone(data.response);
          cb.onFallbackEnvelope?.(data);
        } catch (err) {
          wrapped.onTransportError(
            new ApiError(
              err instanceof Error ? err.message : 'Bad response body',
              { status: response.status },
            ),
          );
        } finally {
          // Fallback path also invalidates session lists.
          qc.invalidateQueries({ queryKey: chatQueryKeys.sessions() });
        }
        return;
      }

      try {
        await readNdjson(response, wrapped, ac.signal);
      } finally {
        // Refresh sessions list & active session detail after each turn.
        qc.invalidateQueries({ queryKey: chatQueryKeys.sessions() });
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [qc],
  );

  return { sendMessage, cancel, phase, setPhase };
}

/**
 * Legacy non-streaming send mutation. Retained for any caller that still
 * imports it (none at time of writing); the chat panel uses `useChat()` above.
 *
 * @deprecated Prefer `useChat()` for the streaming UX.
 */
export function useSendChatMessage(): UseMutationResult<
  ChatPostResponse,
  ApiError,
  { sessionId?: string; message: string }
> {
  const qc = useQueryClient();
  return useMutation<ChatPostResponse, ApiError, { sessionId?: string; message: string }>({
    mutationFn: ({ sessionId, message }) =>
      api.post<ChatPostResponse>('/api/v1/chat', { sessionId, message }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: chatQueryKeys.sessions() });
      qc.invalidateQueries({ queryKey: chatQueryKeys.session(data.sessionId) });
    },
  });
}
