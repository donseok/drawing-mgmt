'use client';

import * as React from 'react';
import { BellOff } from 'lucide-react';

import { PopoverPanel } from '@/components/ui/PopoverPanel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/cn';

/**
 * NotificationPanel — Header bell popover that lists in-app notifications.
 *
 * Built on top of `<PopoverPanel>`. Pure presentational shell:
 *   - The list of `items` is passed in (BE-2 supplies the data via FE-2).
 *   - `onMarkAllRead` is the consumer's hook to call the BE.
 *   - `onItemClick` is fired when a row is activated (used to mark-as-read
 *     and/or navigate via `item.href`).
 *
 * Layout:
 *   ┌─────────────────────────────────────┐
 *   │ 알림                  모두 읽음 처리 │ ← header
 *   ├─────────────────────────────────────┤
 *   │ ● 결재 요청이 도착했습니다  3분 전  │
 *   │   본문 한 줄 클램프…                │ ← scrollable list
 *   │ ─────────────────────────────────── │
 *   │   체크인 완료              1시간 전 │
 *   └─────────────────────────────────────┘
 *
 * Empty state: centered icon + "새로운 알림이 없습니다."
 */
export interface NotificationItem {
  id: string;
  title: string;
  body?: string;
  /** ISO 8601 timestamp; rendered as relative ("3분 전") if recent. */
  ts: string;
  read: boolean;
  /** Optional jump-to URL handled by the consumer. */
  href?: string;
}

export interface NotificationPanelProps {
  /** Bell button (or any element) that opens the panel. */
  trigger: React.ReactNode;
  /** Notifications to render. Pass `[]` to show the empty state. */
  items: NotificationItem[];
  /** Called when the "모두 읽음 처리" button is clicked. */
  onMarkAllRead?: () => void;
  /** Called when an item is activated (click / Enter). */
  onItemClick?: (id: string) => void;
}

/** Format an ISO timestamp as a Korean relative-time string. */
function formatRelativeKo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (Number.isNaN(diffMs)) return '';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  // Older — fall back to YYYY-MM-DD
  const y = then.getFullYear();
  const m = String(then.getMonth() + 1).padStart(2, '0');
  const d = String(then.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function NotificationPanel({
  trigger,
  items,
  onMarkAllRead,
  onItemClick,
}: NotificationPanelProps): JSX.Element {
  const hasUnread = items.some((it) => !it.read);
  const isEmpty = items.length === 0;

  return (
    <PopoverPanel
      trigger={trigger}
      align="end"
      side="bottom"
      className="w-[360px] p-0"
    >
      <div role="region" aria-label="알림 목록" className="flex flex-col">
        {/* Header */}
        <header className="flex h-10 items-center justify-between border-b border-border px-3">
          <h2 className="text-sm font-semibold text-fg">알림</h2>
          <button
            type="button"
            onClick={onMarkAllRead}
            disabled={!hasUnread || !onMarkAllRead}
            className={cn(
              'text-xs font-medium text-brand transition-colors',
              'hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm px-1.5 py-0.5',
              'disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            모두 읽음 처리
          </button>
        </header>

        {/* Body */}
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <BellOff
              className="h-8 w-8 text-fg-subtle"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <p className="text-sm text-fg-muted">새로운 알림이 없습니다.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[480px]">
            <ul role="list" className="divide-y divide-border">
              {items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onClick={() => onItemClick?.(item.id)}
                />
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>
    </PopoverPanel>
  );
}

function NotificationRow({
  item,
  onClick,
}: {
  item: NotificationItem;
  onClick: () => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group relative flex w-full items-start gap-2 px-3 py-2.5 text-left',
          'transition-colors hover:bg-bg-muted',
          'focus-visible:outline-none focus-visible:bg-bg-muted',
          !item.read && 'bg-bg-subtle',
        )}
      >
        {/* Unread dot */}
        <span
          aria-hidden="true"
          className={cn(
            'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full',
            !item.read ? 'bg-brand' : 'bg-transparent',
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={cn(
                'truncate text-sm',
                !item.read ? 'font-semibold text-fg' : 'font-medium text-fg-muted',
              )}
            >
              {item.title}
            </p>
            <time
              dateTime={item.ts}
              className="shrink-0 text-[11px] tabular-nums text-fg-subtle"
            >
              {formatRelativeKo(item.ts)}
            </time>
          </div>
          {item.body ? (
            <p className="truncate text-xs text-fg-muted">{item.body}</p>
          ) : null}
        </div>
        {!item.read ? <span className="sr-only">읽지 않은 알림</span> : null}
      </button>
    </li>
  );
}
