'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';
import type { ChatTurn } from '@/lib/chat-types';
import { MessageBubble } from './MessageBubble';

interface Props {
  turns: ChatTurn[];
  className?: string;
  onRetry?: () => void;
}

/**
 * Day separator if two adjacent turns are >30min apart, or cross a midnight.
 */
function shouldShowSeparator(prev: ChatTurn, next: ChatTurn): boolean {
  try {
    const a = new Date(prev.createdAt);
    const b = new Date(next.createdAt);
    const gap = b.getTime() - a.getTime();
    if (gap > 30 * 60 * 1000) return true;
    if (a.toDateString() !== b.toDateString()) return true;
    return false;
  } catch {
    return false;
  }
}

function formatSeparator(turn: ChatTurn): string {
  try {
    const d = new Date(turn.createdAt);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `오늘 ${time}`;
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${time}`;
  } catch {
    return '';
  }
}

export function MessageList({ turns, className, onRetry }: Props) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  // R36 — pin to the latest turn whenever the list grows.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      className={cn('flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm', className)}
    >
      {turns.map((t, i) => {
        const prev = turns[i - 1];
        const showSeparator = prev ? shouldShowSeparator(prev, t) : false;
        const groupedWithPrev =
          prev && prev.role === t.role && !showSeparator
            ? Math.abs(new Date(t.createdAt).getTime() - new Date(prev.createdAt).getTime()) <
              60 * 1000
            : false;

        return (
          <React.Fragment key={t.id}>
            {showSeparator ? (
              <div className="flex items-center gap-2 py-1 text-[11px] text-fg-subtle">
                <span className="h-px flex-1 bg-border/60" aria-hidden />
                <span>{formatSeparator(t)}</span>
                <span className="h-px flex-1 bg-border/60" aria-hidden />
              </div>
            ) : null}
            <MessageBubble
              turn={t}
              groupedWithPrev={groupedWithPrev}
              onRetry={t.status === 'error' ? onRetry : undefined}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}
