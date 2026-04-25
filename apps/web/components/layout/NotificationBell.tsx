'use client';

import { Bell } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { queryKeys } from '@/lib/queries';

// MOCK fetcher — TODO: replace with real `/api/v1/notifications/unread-count`.
async function fetchUnreadCount(): Promise<number> {
  return 3; // MOCK
}

export function NotificationBell({ className }: { className?: string }) {
  const { data: count = 0 } = useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: fetchUnreadCount,
    staleTime: 30_000,
    placeholderData: 0,
  });

  return (
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
  );
}
