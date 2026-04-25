'use client';

import { MessageSquare, X } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';

// TODO: Designer/Owner of Chat will implement real ChatWidget. For now this
// FAB toggles a placeholder Sheet panel rendered alongside.

export function ChatToggle({ variant = 'fab', className }: { variant?: 'fab' | 'header'; className?: string }) {
  const chatOpen = useUiStore((s) => s.chatOpen);
  const toggle = useUiStore((s) => s.toggleChat);

  if (variant === 'header') {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label="챗봇 토글"
        title="챗봇 (⌘.)"
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted',
          'hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          chatOpen && 'bg-bg-muted text-fg',
          className,
        )}
      >
        <MessageSquare className="h-4 w-4" />
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label="챗봇 열기"
        title="챗봇 (⌘.)"
        className={cn(
          'fixed bottom-6 right-6 z-40 inline-flex h-16 w-16 items-center justify-center rounded-full',
          'bg-brand text-brand-foreground shadow-lg',
          'transition-transform hover:scale-105 active:scale-95',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className,
        )}
      >
        <MessageSquare className="h-6 w-6" />
      </button>

      {chatOpen && <ChatPlaceholderPanel />}
    </>
  );
}

function ChatPlaceholderPanel() {
  const close = useUiStore((s) => s.toggleChat);
  return (
    <div
      role="dialog"
      aria-label="챗봇"
      className="fixed bottom-24 right-6 z-40 flex h-[480px] w-[400px] flex-col rounded-lg border border-border bg-bg shadow-xl"
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />
          <span className="text-sm font-semibold">챗봇</span>
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
            간이
          </span>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="닫기"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 text-sm text-fg-muted">
        {/* MOCK: real ChatWidget out of scope (Phase 1) */}
        챗봇은 곧 연결됩니다. 도면 검색·결재함 조회 등을 자연어로 요청할 수 있게 될 예정입니다.
      </div>
      <div className="border-t border-border p-3">
        <input
          type="text"
          disabled
          placeholder="메시지를 입력하세요..."
          className="h-9 w-full rounded-md border border-border bg-bg-subtle px-3 text-sm placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>
    </div>
  );
}
