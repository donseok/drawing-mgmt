'use client';

import * as React from 'react';
import Link from 'next/link';
import { BellOff, Check } from 'lucide-react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';

/**
 * NotificationPanel — R29 §B.
 *
 * The previous (R6) build was a presentational shell wrapped in
 * `<PopoverPanel>`; the new build is the popover *body* only. The bell
 * (`<NotificationBell>`) keeps owning the popover root + trigger and renders
 * `<NotificationPanelBody>` as `<PopoverContent>` children. This split is
 * what lets the bell mount/unmount the body so polling/queries can suspend
 * while closed.
 *
 * Layout (380×680):
 *   ┌─────────────────────────────────────────┐
 *   │ 알림   [3]                  모두 읽음   │ 40
 *   ├─────────────────────────────────────────┤
 *   │ [전체  •  읽지 않음]                    │ 36
 *   ├─────────────────────────────────────────┤
 *   │ ● 결재 요청이 도착되었습니다 ...        │ list (max ~560)
 *   │ ─────────────────────────────────────  │
 *   │   김지원이 회신했습니다 ...              │
 *   └─────────────────────────────────────────┘
 *
 * Mark-read / mark-all-read mutations live in the consumer (the bell). This
 * component is purely presentational + emits intent events.
 */

export type NotificationFilter = 'all' | 'unread';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body?: string;
  /** ISO 8601 timestamp; rendered as relative ("3분 전") if recent. */
  ts: string;
  read: boolean;
  /** When set, clicking the row navigates to `/objects/{objectId}`. */
  objectId?: string;
}

export interface NotificationPanelBodyProps {
  filter: NotificationFilter;
  onFilterChange: (next: NotificationFilter) => void;
  /** Pages from `useInfiniteQuery`; flatten + render in order. */
  pages: NotificationItem[][];
  unreadCount: number;
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore: () => void;
  onItemClick: (item: NotificationItem) => void;
  onMarkAllRead: () => void;
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
  const y = then.getFullYear();
  const m = String(then.getMonth() + 1).padStart(2, '0');
  const d = String(then.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function NotificationPanelBody({
  filter,
  onFilterChange,
  pages,
  unreadCount,
  isPending,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onItemClick,
  onMarkAllRead,
}: NotificationPanelBodyProps): JSX.Element {
  const items = React.useMemo(() => pages.flat(), [pages]);
  const isEmpty = !isPending && !isError && items.length === 0;

  // Auto-load on scroll: the sentinel near the bottom triggers `onLoadMore`
  // once visible. Cheap IntersectionObserver — no library.
  // R55 [QA-P0-2] — the previous version listed `onLoadMore` directly in the
  // deps. Callers commonly pass a fresh arrow each render (`() => fetchNextPage()`)
  // which made the effect tear-down + re-attach the IO on every parent
  // render. Stash the latest callback in a ref and call through it so the
  // effect only re-runs when the actual signal flags (`hasNextPage`,
  // `isFetchingNextPage`) change.
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const loadMoreRef = React.useRef(onLoadMore);
  React.useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadMoreRef.current();
            break;
          }
        }
      },
      { rootMargin: '0px 0px 100px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage]);

  return (
    <div
      role="region"
      aria-label="알림 목록"
      className="flex w-[380px] flex-col"
    >
      {/* Header — title + unread badge + 모두 읽음 */}
      <header className="flex h-10 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-fg">알림</h2>
          {unreadCount > 0 ? (
            <span
              aria-label={`읽지 않은 알림 ${unreadCount}건`}
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-none text-brand-foreground"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={unreadCount === 0}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-fg-muted',
            'hover:bg-bg-muted hover:text-fg',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
          aria-disabled={unreadCount === 0}
        >
          <Check className="h-3.5 w-3.5" />
          모두 읽음
        </button>
      </header>

      {/* Filter tabs */}
      <Tabs
        value={filter}
        onValueChange={(v) => onFilterChange(v as NotificationFilter)}
      >
        <TabsList className="h-9 w-full justify-start gap-2 border-b border-border px-3">
          <TabsTrigger value="all" className="h-7 px-2 text-xs">
            전체
          </TabsTrigger>
          <TabsTrigger value="unread" className="h-7 px-2 text-xs">
            읽지 않음
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Body */}
      {isPending ? (
        <ul className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-start gap-2 px-3 py-2.5">
              <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-3/4 rounded bg-bg-muted" />
                <div className="h-3 w-1/2 rounded bg-bg-muted" />
              </div>
            </li>
          ))}
        </ul>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
          <p className="text-sm text-danger">알림을 불러오지 못했습니다</p>
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
          <BellOff
            className="h-8 w-8 text-fg-subtle"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <p className="text-sm text-fg-muted">
            {filter === 'unread'
              ? '읽지 않은 알림이 없습니다.'
              : '새로운 알림이 없습니다.'}
          </p>
          {filter === 'unread' ? (
            <button
              type="button"
              onClick={() => onFilterChange('all')}
              className="text-xs text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
            >
              전체 보기
            </button>
          ) : null}
        </div>
      ) : (
        <ScrollArea className="max-h-[560px]">
          <ul role="list" className="divide-y divide-border">
            {items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                onClick={() => onItemClick(item)}
              />
            ))}
          </ul>
          {hasNextPage ? (
            <div
              ref={sentinelRef}
              className="flex h-9 items-center justify-center px-3 text-[11px] text-fg-subtle"
            >
              {isFetchingNextPage ? '불러오는 중…' : ''}
            </div>
          ) : (
            <p className="px-3 py-2 text-center text-[11px] text-fg-subtle">
              더 이상 알림이 없습니다.
            </p>
          )}
        </ScrollArea>
      )}

      {/* R35 N-1 — footer hint guiding users to the email channel toggle. */}
      <footer className="border-t border-border bg-bg-subtle px-3 py-2 text-[11px] text-fg-subtle">
        메일도 받으시려면{' '}
        <Link
          href="/settings"
          className="text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-0.5"
        >
          환경설정
        </Link>
        에서 활성화하세요.
      </footer>
    </div>
  );
}

interface RowProps {
  item: NotificationItem;
  onClick: () => void;
}

function NotificationRow({ item, onClick }: RowProps): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group relative flex w-full items-start gap-2 px-3 py-2.5 text-left',
          'transition-colors hover:bg-bg-muted',
          'focus-visible:outline-none focus-visible:bg-bg-muted',
          !item.read && 'bg-brand/5',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full',
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
            <p
              className={cn(
                'truncate text-xs',
                !item.read ? 'text-fg-muted' : 'text-fg-subtle',
              )}
            >
              {item.body}
            </p>
          ) : null}
        </div>
        {!item.read ? <span className="sr-only">읽지 않은 알림</span> : null}
      </button>
    </li>
  );
}
