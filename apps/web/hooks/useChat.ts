'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import type {
  ChatHealthStatus,
  ChatPostResponse,
  ChatSessionDetail,
  ChatSessionSummary,
  QuickAction,
} from '@/lib/chat-types';

/**
 * R36 — chat data hooks.
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

/**
 * `POST /chat` — the core mutation. Optimistic user message append is handled
 * inside `<ChatPanel>` (it owns the in-memory turn list); the hook just wires
 * the network call + invalidation. Following R3a/R3b mutation pattern.
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
      // Refresh sessions list (new session gains messageCount, title may
      // have just been set on first turn).
      qc.invalidateQueries({ queryKey: chatQueryKeys.sessions() });
      qc.invalidateQueries({ queryKey: chatQueryKeys.session(data.sessionId) });
    },
  });
}
