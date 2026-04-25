'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, Check, Settings2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { queryKeys } from '@/lib/queries';

interface MockNotification {
  id: string;
  title: string;
  body?: string;
  href?: string;
  time: string;
  read: boolean;
}

// MOCK fetcher — TODO: replace with real `/api/v1/notifications/unread-count`.
async function fetchUnreadCount(): Promise<number> {
  return 3;
}

// MOCK list — TODO: `/api/v1/notifications?limit=5`.
const MOCK_NOTIFICATIONS: MockNotification[] = [
  {
    id: 'n-1',
    title: '결재 요청',
    body: 'CGL-MEC-2026-00012 R3 개정',
    href: '/approval?box=waiting',
    time: '10:23',
    read: false,
  },
  {
    id: 'n-2',
    title: '체크인 완료',
    body: 'CGL-ELE-2026-00031 메인 컨트롤 패널',
    href: '/objects/obj-3',
    time: '09:55',
    read: false,
  },
  {
    id: 'n-3',
    title: '결재 승인',
    body: 'BFM-PRC-2026-00008 소둔로 공정 P&ID',
    href: '/objects/obj-4',
    time: '09:14',
    read: false,
  },
  {
    id: 'n-4',
    title: '시스템 공지',
    body: '4/27 02:00~04:00 시스템 점검 예정',
    href: '/admin/notices',
    time: '어제',
    read: true,
  },
];

/**
 * NotificationBell — Header bell icon (DESIGN §4.2).
 * - Shows unread badge (count, capped at 99+).
 * - Click opens a Popover with the latest notifications.
 *
 * If/when Designer-2 ships `@/components/notifications/NotificationPanel`, the
 * inline body below should be swapped out for `<NotificationPanel />` (see
 * NotificationPanelTrigger.tsx for the wrapper that prefers the shared panel
 * when present).
 */
export function NotificationBell({ className }: { className?: string }) {
  const { data: count = 0 } = useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: fetchUnreadCount,
    staleTime: 30_000,
    placeholderData: 0,
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `읽지 않은 알림 ${count}건` : '알림'}
          title="알림"
          className={cn(
            'relative inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted',
            'hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span
              aria-hidden
              className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-0"
      >
        <NotificationListBody notifications={MOCK_NOTIFICATIONS} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Inline notification list body. Used as a fallback while Designer-2's
 * `<NotificationPanel />` lands. Renders title + body + time, with a "모두 읽음"
 * action and a footer link to the full notifications view.
 */
export function NotificationListBody({
  notifications,
}: {
  notifications: MockNotification[];
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-fg">알림</span>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-fg-muted hover:bg-bg-muted hover:text-fg"
        >
          <Check className="h-3.5 w-3.5" />
          모두 읽음
        </button>
      </div>
      <ul className="max-h-80 overflow-auto">
        {notifications.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-fg-muted">
            새 알림이 없습니다.
          </li>
        ) : (
          notifications.map((n) => {
            const Wrapper: React.ElementType = n.href ? Link : 'div';
            const wrapperProps = n.href ? { href: n.href } : {};
            return (
              <li key={n.id} className="border-b border-border last:border-b-0">
                <Wrapper
                  {...wrapperProps}
                  className={cn(
                    'flex items-start gap-2 px-3 py-2.5 text-sm hover:bg-bg-subtle',
                    !n.read && 'bg-brand/5',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                      n.read ? 'bg-transparent' : 'bg-brand',
                    )}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[13px] font-medium text-fg">
                      {n.title}
                    </span>
                    {n.body && (
                      <span className="mt-0.5 block truncate text-[12px] text-fg-muted">
                        {n.body}
                      </span>
                    )}
                  </span>
                  <span className="ml-1 shrink-0 font-mono text-[11px] text-fg-subtle">
                    {n.time}
                  </span>
                </Wrapper>
              </li>
            );
          })
        )}
      </ul>
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <Link
          href="/admin/notices"
          className="text-xs text-fg-muted hover:text-fg hover:underline"
        >
          모든 알림 보기
        </Link>
        <Link
          href="/admin"
          aria-label="알림 설정"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
