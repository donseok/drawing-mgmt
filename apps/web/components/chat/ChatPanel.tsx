'use client';

import * as React from 'react';
import { Menu, X } from 'lucide-react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import type { ChatAction, ChatToolName, ChatTurn } from '@/lib/chat-types';
import {
  useChat,
  useChatHealth,
  useChatSession,
  useChatSessions,
  useDeleteChatSession,
  useQuickActions,
} from '@/hooks/useChat';
import { RobotAvatar, type RobotAvatarState } from './RobotAvatar';
import { ModeBadge, type ChatPanelMode } from './ModeBadge';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { QuickActionsRow } from './QuickActions';
import { SessionSidebar } from './SessionSidebar';

/**
 * R36 — ChatPanel.
 *
 * Owns the in-memory turn list (so we can render `pending`/`error` ephemeral
 * states) and bridges between TanStack Query (for sessions/health/quick
 * actions) and the local mutation lifecycle.
 *
 * R36-polish: switched the send path from a one-shot `useMutation` to the
 * streaming `useChat()` hook. Each delta event mutates the pending assistant
 * turn's `content` so the user sees text grow.
 *
 * Layout decisions:
 * - Desktop (≥640): floating panel anchored bottom-right above the FAB.
 * - Mobile (<640): full-screen sheet via `position: fixed inset-0`.
 * - Sessions sidebar: in-panel slide-in on desktop, full-screen subview on mobile.
 *
 * Accessibility: `role="dialog" aria-modal="false"` (panel is non-blocking),
 * `aria-live="polite"` on the message list, `Esc` closes.
 */

let synthMessageCounter = 0;
function clientMessageId(prefix: string): string {
  synthMessageCounter += 1;
  return `${prefix}-${Date.now()}-${synthMessageCounter}`;
}

// R36-polish §4.2 — natural-language mapping for `tool`-kind actions.
const APPROVAL_BOX_KO: Record<string, string> = {
  waiting: '대기',
  done: '처리완료',
  sent: '상신',
  trash: '회수',
};

function toolToPrompt(action: ChatAction): string {
  const args = (action.toolArgs ?? {}) as Record<string, unknown>;
  const name = action.toolName as ChatToolName | undefined;
  switch (name) {
    case 'search_drawings': {
      const q = typeof args.q === 'string' && args.q.trim() ? args.q.trim() : '최근';
      return `${q} 도면을 찾아줘`;
    }
    case 'get_drawing': {
      const number = typeof args.number === 'string' ? args.number : undefined;
      const id = typeof args.id === 'string' ? args.id : undefined;
      const ref = number ?? (id ? `(id=${id})` : '');
      return `도면 ${ref}을(를) 보여줘`.replace(/\s+/g, ' ').trim();
    }
    case 'list_my_approvals': {
      const box = typeof args.box === 'string' ? args.box : 'waiting';
      const label = APPROVAL_BOX_KO[box] ?? '대기';
      return `내 결재 ${label}함을 보여줘`;
    }
    case 'get_recent_activity': {
      return '최근 활동을 보여줘';
    }
    case 'get_help': {
      const topic = typeof args.topic === 'string' && args.topic.trim() ? args.topic.trim() : '사용법';
      return `${topic} 도움말을 보여줘`;
    }
    default: {
      // Unknown tool — fall back to the action label.
      return action.label;
    }
  }
}

interface ChatPanelProps {
  onRequestClose: () => void;
}

export function ChatPanel({ onRequestClose }: ChatPanelProps) {
  const isMobile = useMediaQuery('(max-width: 639px)');

  // Server state.
  const sessionsQuery = useChatSessions();
  const healthQuery = useChatHealth();
  const quickActionsQuery = useQuickActions();
  const deleteMutation = useDeleteChatSession();

  // Streaming send hook (R36-polish P1).
  const { sendMessage: sendStream, cancel: cancelStream, phase } = useChat();

  // Active session — when undefined we are in "new conversation" mode.
  const [activeSessionId, setActiveSessionId] = React.useState<string | undefined>(undefined);
  const sessionDetail = useChatSession(activeSessionId);

  // In-memory turns (the rendered list). Hydrated from server on session pick,
  // mutated locally on send.
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [composerValue, setComposerValue] = React.useState('');
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = React.useState<number | null>(null);
  const [isSending, setIsSending] = React.useState(false);

  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  // Hydrate turns from a fetched session.
  React.useEffect(() => {
    if (!activeSessionId) {
      setTurns([]);
      return;
    }
    const detail = sessionDetail.data;
    if (!detail) return;
    setTurns(
      detail.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        mode: m.mode,
        createdAt: m.createdAt,
        sources: m.sources,
        actions: m.actions,
        status: 'sent',
      })),
    );
  }, [activeSessionId, sessionDetail.data]);

  // Auto-focus composer when panel mounts. (Open is controlled by the parent
  // via `chatOpen`; this component only mounts while open.)
  React.useEffect(() => {
    composerRef.current?.focus();
  }, []);

  // Esc closes panel (or sidebar, if open). ⌘. is handled globally already.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (sidebarOpen) {
          setSidebarOpen(false);
          return;
        }
        onRequestClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen, onRequestClose]);

  // Cancel any in-flight stream on unmount (panel close).
  React.useEffect(() => {
    return () => {
      cancelStream();
    };
  }, [cancelStream]);

  // Derived: header mode badge.
  const healthMode: ChatPanelMode | undefined = React.useMemo(() => {
    const h = healthQuery.data;
    if (!h) return undefined;
    if (!h.llmReachable && !h.embeddingReachable) {
      // Both off → effectively rule mode but reachable; "offline" only if API itself fails.
      return 'rule';
    }
    return h.decision;
  }, [healthQuery.data]);

  const lastAssistantTurn = [...turns].reverse().find((t) => t.role === 'ASSISTANT');
  const lastTurnMode: ChatPanelMode = lastAssistantTurn?.mode === 'RAG' ? 'rag' : 'rule';
  const headerMode: ChatPanelMode = healthMode ?? lastTurnMode;

  // Avatar state — driven by streaming phase (P5 — RobotAvatar phase sync).
  const avatarState: RobotAvatarState = React.useMemo(() => {
    if (phase === 'thinking') return 'thinking';
    if (phase === 'speaking') return 'speaking';
    if (phase === 'error') return 'error';
    if (turns.some((t) => t.status === 'error')) return 'error';
    return 'idle';
  }, [phase, turns]);

  // Handlers --------------------------------------------------------------

  const sendMessage = React.useCallback(
    (text: string) => {
      const trimmed = text.trim().slice(0, 4000);
      if (!trimmed) return;
      if (isSending) return; // Block double-send while streaming.

      const optimisticUser: ChatTurn = {
        id: clientMessageId('u'),
        role: 'USER',
        content: trimmed,
        createdAt: new Date().toISOString(),
        status: 'sent',
      };
      const pendingAssistantId = clientMessageId('a-pending');
      const optimisticAssistant: ChatTurn = {
        id: pendingAssistantId,
        role: 'ASSISTANT',
        content: '',
        createdAt: new Date().toISOString(),
        status: 'pending',
      };

      setTurns((prev) => [...prev, optimisticUser, optimisticAssistant]);
      setComposerValue('');
      setIsSending(true);

      // Track the current id of the pending turn so we can update by it across
      // the meta event (which swaps the id for the BE-issued messageId).
      let currentPendingId = pendingAssistantId;

      void sendStream(
        { sessionId: activeSessionId, message: trimmed },
        {
          onMeta: (meta) => {
            setActiveSessionId(meta.sessionId);
            setTurns((prev) =>
              prev.map((t) =>
                t.id === currentPendingId
                  ? {
                      ...t,
                      id: meta.messageId,
                      mode: meta.mode === 'rag' ? 'RAG' : 'RULE',
                    }
                  : t,
              ),
            );
            currentPendingId = meta.messageId;
          },
          onDelta: (cumulative) => {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === currentPendingId
                  ? { ...t, content: cumulative }
                  : t,
              ),
            );
          },
          onSources: (sources) => {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === currentPendingId ? { ...t, sources } : t,
              ),
            );
          },
          onActions: (actions) => {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === currentPendingId ? { ...t, actions } : t,
              ),
            );
          },
          onInlineError: (error) => {
            const friendly = error.message || '응답을 받지 못했어요. 잠시 후 다시 시도해주세요.';
            setTurns((prev) =>
              prev.map((t) =>
                t.id === currentPendingId
                  ? {
                      ...t,
                      content: t.content || friendly,
                      status: 'error',
                      error: { message: friendly, retryable: true },
                    }
                  : t,
              ),
            );
          },
          onTransportError: (err) => {
            const apiErr = err instanceof ApiError ? err : null;
            const isRate = apiErr?.code === 'E_RATE_LIMIT' || apiErr?.status === 429;
            const isAuth = apiErr?.code === 'E_AUTH' || apiErr?.status === 401;
            const friendly = isAuth
              ? '세션이 만료되었어요. 다시 로그인해주세요.'
              : isRate
                ? '잠시만요, 너무 빨리 보내고 계세요. 잠시 후 다시 시도해주세요.'
                : (apiErr?.message ?? '응답을 받지 못했어요. 잠시 후 다시 시도해주세요.');

            if (isRate) {
              const retryAfter =
                Number((apiErr?.details as { retryAfterMs?: number } | undefined)?.retryAfterMs) ||
                30_000;
              setRateLimitedUntil(Date.now() + retryAfter);
              window.setTimeout(() => setRateLimitedUntil(null), retryAfter);
            }

            setTurns((prev) =>
              prev.map((t) =>
                t.id === currentPendingId
                  ? {
                      ...t,
                      content: friendly,
                      status: 'error',
                      error: { message: friendly, retryable: !isAuth },
                    }
                  : t,
              ),
            );
          },
          onDone: () => {
            setIsSending(false);
            setTurns((prev) =>
              prev.map((t) => {
                if (t.id !== currentPendingId) return t;
                // If we never moved off `pending` (e.g. inline error already
                // marked it `error`), respect that. Otherwise mark `sent`.
                if (t.status === 'error') return t;
                return { ...t, status: 'sent' };
              }),
            );
          },
        },
      ).finally(() => {
        // Safety: ensure isSending is unstuck even if onDone didn't fire.
        setIsSending(false);
      });
    },
    [activeSessionId, isSending, sendStream],
  );

  const onRetryLastError = React.useCallback(() => {
    // Find the most recent USER turn — that's what the user wants resent.
    const lastUser = [...turns].reverse().find((t) => t.role === 'USER');
    if (!lastUser) return;
    // Strip the trailing error turn(s) before re-sending.
    setTurns((prev) => {
      const next = [...prev];
      while (next.length && next[next.length - 1]?.role === 'ASSISTANT' && next[next.length - 1]?.status === 'error') {
        next.pop();
      }
      // also strip the user message we're about to re-add
      while (next.length && next[next.length - 1]?.id === lastUser.id) {
        next.pop();
      }
      return next;
    });
    sendMessage(lastUser.content);
  }, [turns, sendMessage]);

  const onPickSession = React.useCallback((id: string) => {
    setActiveSessionId(id);
    setSidebarOpen(false);
  }, []);

  const onNewSession = React.useCallback(() => {
    cancelStream();
    setActiveSessionId(undefined);
    setTurns([]);
    setSidebarOpen(false);
    composerRef.current?.focus();
  }, [cancelStream]);

  const onDeleteSession = React.useCallback(
    (id: string) => {
      deleteMutation.mutate(id, {
        onSuccess: () => {
          if (id === activeSessionId) onNewSession();
        },
      });
    },
    [deleteMutation, activeSessionId, onNewSession],
  );

  // R36-polish — composer fill (used by `prompt`-kind actions everywhere).
  const onSelectPrompt = React.useCallback((text: string) => {
    setComposerValue(text);
    composerRef.current?.focus();
  }, []);

  // R36-polish — `tool`-kind actions in finished bubbles trigger a synthetic
  // user turn via natural-language prompt (contract §4.2).
  const onInvokeTool = React.useCallback(
    (action: ChatAction) => {
      const prompt = toolToPrompt(action);
      sendMessage(prompt);
    },
    [sendMessage],
  );

  // Quick-action variants.
  const onQuickActionPromptFill = React.useCallback((text: string) => {
    setComposerValue((prev) => (prev ? `${prev} ${text}` : text));
    composerRef.current?.focus();
  }, []);

  const onQuickActionDispatch = React.useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage],
  );

  // ----------------------------------------------------------------------

  const containerClass = isMobile
    ? 'fixed inset-0 z-50 flex flex-col bg-bg'
    : cn(
        'fixed bottom-20 right-5 z-40 flex h-[640px] w-[420px] flex-col overflow-hidden rounded-lg border border-border bg-bg elevation-modal',
        'animate-panel-enter',
      );

  const isEmpty = turns.length === 0;
  const quickActions = quickActionsQuery.data?.actions ?? [];

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="chat-panel-title"
      aria-describedby="chat-panel-desc"
      className={containerClass}
    >
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg px-3">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="이전 대화"
          aria-expanded={sidebarOpen}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded text-fg-muted',
            'hover:bg-bg-muted hover:text-fg',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            sidebarOpen && 'bg-bg-muted text-fg',
          )}
        >
          <Menu className="h-4 w-4" />
        </button>
        <RobotAvatar size="header" state={avatarState} />
        <div className="min-w-0 flex-1">
          <div id="chat-panel-title" className="text-sm font-semibold text-fg">
            Dolly
          </div>
          <div id="chat-panel-desc" className="text-[11px] text-fg-muted">
            {phase === 'thinking'
              ? '생각하고 있어요…'
              : phase === 'speaking'
                ? '응답하는 중…'
                : avatarState === 'error'
                  ? '잠시 후 다시 시도해 주세요'
                  : '도면관리 도우미'}
          </div>
        </div>
        <ModeBadge mode={headerMode} reason={healthQuery.data?.reason} />
        <button
          type="button"
          onClick={onRequestClose}
          aria-label="닫기"
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded text-fg-muted',
            'hover:bg-bg-muted hover:text-fg',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body — relatively positioned to host sidebar */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {isEmpty ? (
          <EmptySession
            onPromptFill={onQuickActionPromptFill}
            onPromptDispatch={onQuickActionDispatch}
            quickActions={quickActions}
            quickActionsLoading={quickActionsQuery.isLoading}
            mode={headerMode}
          />
        ) : (
          <MessageList
            turns={turns}
            onRetry={onRetryLastError}
            onSelectPrompt={onSelectPrompt}
            onInvokeTool={onInvokeTool}
          />
        )}

        {!isEmpty ? (
          <div className="border-t border-border bg-bg/95 backdrop-blur">
            <QuickActionsRow
              actions={quickActions}
              loading={quickActionsQuery.isLoading}
              layout="row"
              onPrompt={onQuickActionDispatch}
            />
          </div>
        ) : null}

        <SessionSidebar
          open={sidebarOpen}
          mobile={isMobile}
          sessions={sessionsQuery.data?.sessions ?? []}
          loading={sessionsQuery.isLoading}
          activeSessionId={activeSessionId}
          onPickSession={onPickSession}
          onNewSession={onNewSession}
          onDeleteSession={onDeleteSession}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <MessageInput
        value={composerValue}
        onChange={setComposerValue}
        onSubmit={() => sendMessage(composerValue)}
        textareaRef={composerRef}
        pending={isSending}
        rateLimitedUntil={rateLimitedUntil ?? undefined}
      />
      <div className="border-t border-border bg-bg/60 px-3 py-1 text-center text-[10px] text-fg-subtle">
        AI 응답은 정확하지 않을 수 있어요 · 출처 확인 권장
      </div>
    </div>
  );
}

interface EmptySessionProps {
  quickActions: import('@/lib/chat-types').QuickAction[];
  quickActionsLoading: boolean;
  onPromptFill: (text: string) => void;
  onPromptDispatch: (text: string) => void;
  mode: ChatPanelMode;
}

function EmptySession({
  quickActions,
  quickActionsLoading,
  onPromptFill,
  onPromptDispatch,
  mode,
}: EmptySessionProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-6">
      <RobotAvatar size="hero" />
      <div className="space-y-1 text-center">
        <div className="text-sm text-fg-muted">
          안녕하세요! 저는 도면관리 도우미 <span className="font-semibold text-fg">Dolly</span>예요.
        </div>
        <div className="text-sm text-fg-muted">
          도면 검색·결재 안내·매뉴얼 질문에 도와드릴 수 있어요.
        </div>
        {mode === 'rule' ? (
          <div className="pt-1 text-[11px] text-warning">
            지금은 <strong>간이 모드</strong>예요. 자연어 응답이 제한될 수 있어요.
          </div>
        ) : null}
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        이렇게 시작해보세요
      </div>
      <QuickActionsRow
        actions={quickActions}
        loading={quickActionsLoading}
        layout="grid"
        onPrompt={(text) => {
          // For empty-state, prompt-kind fills the composer instead of sending.
          // Tool-kind sends a synthetic message.
          // We can't tell here which is which (label-only) — but `prompt`
          // actions reach this callback with `promptText`, while `tool` reaches
          // with `label`. Simplification: treat `prompt`-style fills as fill
          // operations in the composer, and tool-style as immediate dispatch.
          // The QuickActionsRow component already routed prompt → onPrompt
          // (text=promptText) and tool → onPrompt (text=label); we mirror that
          // by checking the matching action.
          const matched = quickActions.find(
            (a) => a.promptText === text || a.label === text,
          );
          if (matched?.kind === 'prompt') onPromptFill(text);
          else onPromptDispatch(text);
        }}
      />
    </div>
  );
}
