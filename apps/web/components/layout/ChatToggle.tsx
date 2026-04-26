'use client';

import * as React from 'react';
import { MessageSquare, Send, X } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';
import { api, ApiError } from '@/lib/api-client';

export function ChatToggle({ variant = 'fab', className }: { variant?: 'fab' | 'header'; className?: string }) {
  const chatOpen = useUiStore((s) => s.chatOpen);
  const toggle = useUiStore((s) => s.toggleChat);

  if (variant === 'header') {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label="AI 도우미 토글"
        title="AI 도우미 (Ctrl+.)"
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
        aria-label="AI 도우미 열기"
        title="AI 도우미 (Ctrl+.)"
        className={cn(
          'fixed bottom-5 right-5 z-40 inline-flex h-12 w-12 items-center justify-center rounded-md',
          'border border-border bg-bg text-fg shadow-lg',
          'transition-colors hover:bg-bg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className,
        )}
      >
        <MessageSquare className="h-5 w-5" />
      </button>

      {chatOpen && <ChatPanel />}
    </>
  );
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

function ChatPanel() {
  const close = useUiStore((s) => s.toggleChat);
  const [turns, setTurns] = React.useState<ChatTurn[]>([
    {
      id: 'intro',
      role: 'assistant',
      text: '도면 검색, 결재함 조회, 매뉴얼 안내를 도와드립니다. 무엇이 궁금하신가요?',
    },
  ]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Keep the scroll pinned to the latest turn when new messages arrive.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    const userTurn: ChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    setTurns((t) => [...t, userTurn]);
    setInput('');
    setSending(true);
    try {
      const res = await api.post<{ response: string }>('/api/v1/chat', {
        message: trimmed,
      });
      setTurns((t) => [
        ...t,
        { id: `a-${Date.now()}`, role: 'assistant', text: res.response },
      ]);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : '응답을 받지 못했습니다.';
      setTurns((t) => [
        ...t,
        { id: `e-${Date.now()}`, role: 'assistant', text: `⚠️ ${msg}` },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="AI 도우미"
      className="fixed bottom-20 right-5 z-40 flex h-[480px] w-[min(400px,calc(100vw-40px))] flex-col rounded-lg border border-border bg-bg shadow-xl"
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />
          <span className="text-sm font-semibold">AI 도우미</span>
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
            안내
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
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-auto p-4 text-sm">
        {turns.map((t) => (
          <div
            key={t.id}
            className={cn(
              'flex',
              t.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-md px-3 py-2 leading-relaxed',
                t.role === 'user'
                  ? 'bg-brand text-brand-foreground'
                  : 'bg-bg-subtle text-fg',
              )}
            >
              {t.text}
            </div>
          </div>
        ))}
        {sending ? (
          <div className="flex justify-start">
            <div className="rounded-md bg-bg-subtle px-3 py-2 text-fg-muted">…</div>
          </div>
        ) : null}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="메시지를 입력하세요..."
          aria-label="AI 도우미 메시지"
          className="h-9 flex-1 rounded-md border border-border bg-bg-subtle px-3 text-sm placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          aria-label="전송"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-brand text-brand-foreground hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
