'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, Check, Settings2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { queryKeys } from '@/lib/queries';
import { api, ApiError } from '@/lib/api-client';
import { activityLabel } from '@/lib/activity-labels';

// BE notification shape — synthesized from ActivityLog rows on the server.
// `read` is always false today; the schema has no Notification table so
// mark-read is a no-op success and we maintain the read state locally.
interface NotificationItemDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  ts: string;
  read: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  // YYYY-MM-DD for older entries
  return iso.slice(0, 10);
}

export function NotificationBell({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  // Locally-tracked read ids — BUG-11 lets users dismiss notifications even
  // though the BE has no Notification table yet. The set survives
  // re-renders but resets on full reload (acceptable until a real table ships).
  const [readIds, setReadIds] = React.useState<Set<string>>(() => new Set());

  const { data: countRaw = 0 } = useQuery<number, ApiError>({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: () => api.get<number>('/api/v1/notifications/unread-count'),
    staleTime: 30_000,
    placeholderData: 0,
  });

  const { data: items = [] } = useQuery<NotificationItemDTO[], ApiError>({
    queryKey: queryKeys.notifications.all(),
    queryFn: () =>
      api.get<NotificationItemDTO[]>('/api/v1/notifications', {
        query: { limit: 10 },
      }),
    staleTime: 30_000,
  });

  // Effective unread = server count minus locally-marked reads (clamped at 0).
  const visibleUnread = Math.max(0, countRaw - readIds.size);

  const markAllRead = async () => {
    // Optimistically zero the badge by adding every visible id to the local
    // read set. Then fire fire-and-forget POSTs so the BE audit trail still
    // reflects intent (the endpoint is a 200-only no-op when there's no
    // Notification table).
    const ids = items.filter((i) => !readIds.has(i.id)).map((i) => i.id);
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    // Reset the unread-count cache so the badge updates without waiting for
    // the next refetch.
    queryClient.setQueryData(queryKeys.notifications.unreadCount(), 0);

    await Promise.allSettled(
      ids.map((id) => api.post(`/api/v1/notifications/${id}/read`)),
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            visibleUnread > 0 ? `읽지 않은 알림 ${visibleUnread}건` : '알림'
          }
          title="알림"
          className={cn(
            'relative inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted',
            'hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <Bell className="h-4 w-4" />
          {visibleUnread > 0 && (
            <span
              aria-hidden
              className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white"
            >
              {visibleUnread > 99 ? '99+' : visibleUnread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <NotificationListBody
          items={items}
          readIds={readIds}
          onMarkAllRead={markAllRead}
        />
      </PopoverContent>
    </Popover>
  );
}

export function NotificationListBody({
  items,
  readIds,
  onMarkAllRead,
}: {
  items: NotificationItemDTO[];
  readIds: Set<string>;
  onMarkAllRead: () => void;
}) {
  const allRead = items.every((i) => readIds.has(i.id));
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-fg">알림</span>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={allRead || items.length === 0}
          className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-fg-muted hover:bg-bg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          모두 읽음
        </button>
      </div>
      <ul className="max-h-80 overflow-auto">
        {items.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-fg-muted">
            새 알림이 없습니다.
          </li>
        ) : (
          items.map((n) => {
            const isRead = readIds.has(n.id) || n.read;
            return (
              <li key={n.id} className="border-b border-border last:border-b-0">
                <div
                  className={cn(
                    'flex items-start gap-2 px-3 py-2.5 text-sm hover:bg-bg-subtle',
                    !isRead && 'bg-brand/5',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                      isRead ? 'bg-transparent' : 'bg-brand',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-fg">
                      {n.title || activityLabel(n.type)}
                    </span>
                    {n.body && (
                      <span className="mt-0.5 block truncate text-[12px] text-fg-muted">
                        {n.body}
                      </span>
                    )}
                  </span>
                  <span className="ml-1 shrink-0 font-mono text-[11px] text-fg-subtle">
                    {formatTime(n.ts)}
                  </span>
                </div>
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
