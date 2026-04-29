'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Copy, RefreshCw } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';
import type { ChatAction, ChatSource, ChatTurn } from '@/lib/chat-types';
import { RobotAvatar, type RobotAvatarState } from './RobotAvatar';

interface Props {
  turn: ChatTurn;
  /**
   * Whether this turn shares its avatar with the previous turn (same role
   * within 60s). Suppresses the avatar to keep dense flow.
   */
  groupedWithPrev?: boolean;
  /** Click → re-send the previous user message and remove the error. */
  onRetry?: () => void;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function copyToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(text).catch(() => {
      // Best effort — clipboard can throw on permissions; swallow silently
      // because the surface here is decorative (toast already too noisy).
    });
  }
}

export function MessageBubble({ turn, groupedWithPrev, onRetry }: Props) {
  const isUser = turn.role === 'USER';
  const isSystem = turn.role === 'SYSTEM';
  const isError = turn.status === 'error';
  const isPending = turn.status === 'pending';

  // System messages render centered, no bubble.
  if (isSystem) {
    return (
      <div className="my-2 text-center text-[11px] text-fg-muted" role="note">
        {turn.content}
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] flex-col items-end gap-1">
          <div
            className={cn(
              'rounded-2xl rounded-tr-sm bg-brand px-3.5 py-2.5 text-sm text-brand-foreground',
              'whitespace-pre-wrap break-words',
            )}
          >
            {turn.content}
          </div>
          <div className="text-[11px] text-fg-subtle">{formatTime(turn.createdAt)}</div>
        </div>
      </div>
    );
  }

  // Assistant turn — branch by status.
  const avatarState: RobotAvatarState = isError
    ? 'error'
    : isPending
      ? 'thinking'
      : 'speaking';

  return (
    <div className="flex items-start gap-2">
      <div className="w-6 shrink-0 pt-1">
        {!groupedWithPrev ? (
          <RobotAvatar size="message" state={avatarState} />
        ) : null}
      </div>
      <div className="flex max-w-[85%] flex-col gap-1">
        {isPending ? (
          <ThinkingBubble />
        ) : isError ? (
          <ErrorBubble turn={turn} onRetry={onRetry} />
        ) : (
          <AssistantBubble turn={turn} />
        )}
        <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
          <span>{formatTime(turn.createdAt)}</span>
          {turn.mode ? (
            <>
              <span aria-hidden>·</span>
              <span className="uppercase tracking-wide">{turn.mode === 'RAG' ? 'RAG' : 'RULE'}</span>
            </>
          ) : null}
          {!isPending && !isError ? (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={() => copyToClipboard(turn.content)}
                aria-label="응답 복사"
                className="inline-flex items-center gap-0.5 hover:text-fg"
              >
                <Copy className="h-3 w-3" />
                복사
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="응답 생성 중"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-bot-soft px-3.5 py-3',
      )}
    >
      <span className="h-1.5 w-1.5 animate-bot-thinking-dot rounded-full bg-fg-muted" style={{ animationDelay: '0s' }} />
      <span className="h-1.5 w-1.5 animate-bot-thinking-dot rounded-full bg-fg-muted" style={{ animationDelay: '0.2s' }} />
      <span className="h-1.5 w-1.5 animate-bot-thinking-dot rounded-full bg-fg-muted" style={{ animationDelay: '0.4s' }} />
    </div>
  );
}

function ErrorBubble({ turn, onRetry }: { turn: ChatTurn; onRetry?: () => void }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-2xl rounded-tl-sm border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-fg',
      )}
    >
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div className="whitespace-pre-wrap break-words">{turn.content}</div>
      </div>
      {turn.error?.retryable && onRetry ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-md border border-danger/30 bg-bg px-2 text-xs font-medium text-fg',
              'hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <RefreshCw className="h-3 w-3" />
            다시 시도
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AssistantBubble({ turn }: { turn: ChatTurn }) {
  return (
    <div
      className={cn(
        'rounded-2xl rounded-tl-sm bg-bot-soft px-3.5 py-2.5 text-sm text-fg',
        'animate-panel-enter',
      )}
    >
      <div className="whitespace-pre-wrap break-words">{turn.content}</div>
      {turn.sources && turn.sources.length > 0 ? (
        <SourcesRow sources={turn.sources} />
      ) : null}
      {turn.actions && turn.actions.length > 0 ? (
        <ActionsRow actions={turn.actions} />
      ) : null}
    </div>
  );
}

function SourcesRow({ sources }: { sources: ChatSource[] }) {
  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
        출처
      </div>
      <div className="flex flex-wrap gap-1">
        {sources.map((s) => {
          const high = s.similarity >= 0.8;
          return (
            <span
              key={s.chunkId}
              title={`${s.source}: ${s.title} · 유사도 ${s.similarity.toFixed(2)}`}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded bg-bg-muted px-2 text-[11px] font-medium text-fg-muted',
                'hover:bg-bg-subtle hover:text-fg',
              )}
            >
              {high ? (
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
              ) : null}
              <span className="font-semibold uppercase">{s.source}</span>
              <span className="truncate max-w-[140px]">{s.title}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ActionsRow({ actions }: { actions: ChatAction[] }) {
  const router = useRouter();
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);

  const dispatch = (a: ChatAction) => {
    if (a.kind === 'navigate' && a.href) {
      router.push(a.href);
      return;
    }
    if (a.kind === 'palette') {
      setPaletteOpen(true);
      return;
    }
    // tool/prompt actions inside a finished message bubble are non-trivial
    // (would need composer access via callback); R36 keeps them no-op visual.
    // The empty-state QuickActions row covers prompt/tool cases.
  };

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
        다음에 할 일
      </div>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a, i) => (
          <button
            key={`${a.label}-${i}`}
            type="button"
            onClick={() => dispatch(a)}
            disabled={a.kind === 'tool' || a.kind === 'prompt'}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-md border border-border bg-bg px-2 text-[11px] font-medium text-fg',
              'transition-colors hover:border-brand hover:text-brand',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
