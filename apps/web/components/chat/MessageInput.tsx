'use client';

import * as React from 'react';
import { Loader2, Send } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /** Hard-blocked because the user's hitting rate limit; counter is shown in label. */
  rateLimitedUntil?: number;
  /** Spinner replaces the send arrow while a request is in-flight. */
  pending?: boolean;
  /** Imperative focus hook (e.g. quick-action `prompt` fills + focuses). */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
}

const MAX_LEN = 4000;

/**
 * Composer (textarea + send + hint).
 *
 * Key behaviors:
 * - Enter sends, Shift+Enter inserts a newline. IME composition (Korean
 *   double-consonant assembly) is preserved by checking
 *   `e.nativeEvent.isComposing`.
 * - Auto-grows up to 6 rows, scrolls beyond.
 * - 4000 char hard cap, soft warning ≥ 3500.
 */
export function MessageInput({
  value,
  onChange,
  onSubmit,
  disabled,
  rateLimitedUntil,
  pending,
  textareaRef,
}: Props) {
  const internalRef = React.useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? internalRef;

  // Auto-resize.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 20; // matches text-sm leading-relaxed
    const max = lineHeight * 6 + 16; // 6 rows + padding
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value, ref]);

  // Live countdown for rate-limit hint.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!rateLimitedUntil) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [rateLimitedUntil]);
  const secsLeft = rateLimitedUntil ? Math.max(0, Math.ceil((rateLimitedUntil - now) / 1000)) : 0;

  const trimmed = value.trim();
  const tooLong = value.length > MAX_LEN;
  const blocked = disabled || pending || !!rateLimitedUntil;
  const cantSend = !trimmed || tooLong || blocked;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // R36 — IME guard. nativeEvent.isComposing is true while Korean Hangul
    // is being assembled; we let Enter pass through to the IME instead of
    // firing a send.
    if (e.key === 'Enter' && !e.shiftKey) {
      const native = e.nativeEvent as unknown as { isComposing?: boolean };
      if (native.isComposing) return;
      e.preventDefault();
      if (!cantSend) onSubmit();
    }
  };

  const counter = value.length;
  const showCounter = counter >= 3500;

  return (
    <div className="border-t border-border bg-bg p-2">
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="무엇을 도와드릴까요? (예: 'CGL-MEC-2026-00012 보여줘')"
            aria-label="메시지 입력"
            rows={1}
            maxLength={MAX_LEN + 200 /* allow paste, then trim on submit */}
            className={cn(
              'block w-full resize-none rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm leading-relaxed',
              'placeholder:text-fg-subtle',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tooLong && 'border-danger/60 bg-danger/10',
            )}
            disabled={disabled}
          />
          {showCounter ? (
            <div
              className={cn(
                'pointer-events-none absolute bottom-1 right-2 text-[10px] tabular-nums',
                tooLong ? 'text-danger' : 'text-fg-subtle',
              )}
            >
              {counter}/{MAX_LEN}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            if (!cantSend) onSubmit();
          }}
          disabled={cantSend}
          aria-label="전송"
          className={cn(
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground',
            'hover:bg-brand-hover',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      <div className="flex items-center justify-between px-1 pt-1 text-[10px] text-fg-subtle">
        <span>Enter 전송 · Shift+Enter 줄바꿈 · ⌘. 닫기</span>
        {rateLimitedUntil && secsLeft > 0 ? (
          <span className="text-warning">잠시만요 · {secsLeft}s 후 가능</span>
        ) : null}
      </div>
    </div>
  );
}
