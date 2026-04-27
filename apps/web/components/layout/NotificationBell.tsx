'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Settings2 } from 'lucide-react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { queryKeys } from '@/lib/queries';
import { api, ApiError } from '@/lib/api-client';
import {
  NotificationPanelBody,
  type NotificationFilter,
  type NotificationItem,
} from '@/components/notifications/NotificationPanel';

/**
 * NotificationBell — header trigger + popover.
 *
 * R29 §B replaces the R6 fake-mark-read flow:
 *   - `GET /api/v1/notifications` is now real (Notification table) with
 *     cursor pagination + `unreadOnly` filter.
 *   - `POST /api/v1/notifications/{id}/read` and `/read-all` actually move
 *     `readAt`. We use optimistic updates for both so the dot/count flip
 *     immediately on click.
 *   - The panel body is `<NotificationPanelBody>` from `notifications/`.
 *     Bell owns: state, queries, mutations, navigation. Body owns: layout.
 *
 * Polling cadence (PM-DECISION-9 default = 30s):
 *   - Panel closed → only `unread-count` polls @ 30s.
 *   - Panel open → list refetches on focus; count keeps the same cadence.
 */

interface NotificationListEnvelope {
  data: NotificationItem[];
  meta: { nextCursor: string | null; unreadCount?: number };
}

interface UnreadCountResponse {
  count: number;
}

async function fetchNotifications(params: {
  unreadOnly?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<NotificationListEnvelope> {
  const url = new URL('/api/v1/notifications', window.location.origin);
  if (params.unreadOnly) url.searchParams.set('unreadOnly', '1');
  if (params.cursor) url.searchParams.set('cursor', params.cursor);
  url.searchParams.set('limit', String(params.limit ?? 30));
  const res = await fetch(url.toString(), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const env = (parsed as { error?: { code?: string; message?: string } } | undefined)
      ?.error;
    throw new ApiError(env?.message ?? `Request failed (${res.status})`, {
      code: env?.code,
      status: res.status,
    });
  }
  // Some BE versions return either `{ data, meta }` or a bare array;
  // normalize defensively.
  if (Array.isArray(parsed)) {
    return { data: parsed as NotificationItem[], meta: { nextCursor: null } };
  }
  // The R29 BE rewrite returns `{ data, meta }`; older builds may also
  // include an `ok: true` flag — both shapes share the fields we need.
  const env = parsed as NotificationListEnvelope & { ok?: boolean };
  return { data: env.data, meta: env.meta ?? { nextCursor: null } };
}

export function NotificationBell({ className }: { className?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<NotificationFilter>('all');

  // ── Unread count (always polled, lightweight). The list query also
  //    surfaces a `meta.unreadCount` but we keep the dedicated endpoint
  //    so the badge stays accurate even when the panel is closed.
  const unreadCountQuery = useQuery<number, ApiError>({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: async () => {
      const data = await api.get<number | UnreadCountResponse>(
        '/api/v1/notifications/unread-count',
      );
      // BE may return either the bare number (api-client unwraps `data`) or
      // `{ count }`. Normalize.
      if (typeof data === 'number') return data;
      return data?.count ?? 0;
    },
    refetchInterval: 30_000,
    staleTime: 30_000,
    placeholderData: 0,
  });

  // ── List query — only enabled while the panel is open. Keyed by filter
  //    so 전체/읽지 않음 caches separately.
  const unreadOnly = filter === 'unread';
  const listQuery = useInfiniteQuery<NotificationListEnvelope, ApiError>({
    queryKey: queryKeys.notifications.list({ unreadOnly }),
    queryFn: ({ pageParam }) =>
      fetchNotifications({
        unreadOnly,
        cursor: pageParam as string | undefined,
        limit: 30,
      }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled: open,
    staleTime: 30_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────
  // Optimistic update for mark-read + mark-all. We patch the list cache
  // for both filter keys (전체 / 읽지 않음) and the unread-count cache.
  // On error we restore from the snapshot.

  const markReadMutation = useMutation<
    unknown,
    ApiError,
    string,
    {
      previousAll?: ReturnType<typeof getInfinite>;
      previousUnread?: ReturnType<typeof getInfinite>;
      previousCount?: number;
    }
  >({
    mutationFn: (id) => api.post(`/api/v1/notifications/${id}/read`),
    onMutate: async (id) => {
      const allKey = queryKeys.notifications.list({ unreadOnly: false });
      const unreadKey = queryKeys.notifications.list({ unreadOnly: true });
      const countKey = queryKeys.notifications.unreadCount();
      await queryClient.cancelQueries({ queryKey: allKey });
      await queryClient.cancelQueries({ queryKey: unreadKey });
      await queryClient.cancelQueries({ queryKey: countKey });
      const previousAll = getInfinite(queryClient, allKey);
      const previousUnread = getInfinite(queryClient, unreadKey);
      const previousCount = queryClient.getQueryData<number>(countKey) ?? 0;
      queryClient.setQueryData(allKey, mapInfinite(previousAll, id, true));
      queryClient.setQueryData(unreadKey, mapInfinite(previousUnread, id, true));
      queryClient.setQueryData(countKey, Math.max(0, previousCount - 1));
      return { previousAll, previousUnread, previousCount };
    },
    onError: (_err, _id, ctx) => {
      if (!ctx) return;
      queryClient.setQueryData(
        queryKeys.notifications.list({ unreadOnly: false }),
        ctx.previousAll,
      );
      queryClient.setQueryData(
        queryKeys.notifications.list({ unreadOnly: true }),
        ctx.previousUnread,
      );
      queryClient.setQueryData(
        queryKeys.notifications.unreadCount(),
        ctx.previousCount,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
    },
  });

  const markAllReadMutation = useMutation<
    unknown,
    ApiError,
    void,
    {
      previousAll?: ReturnType<typeof getInfinite>;
      previousUnread?: ReturnType<typeof getInfinite>;
      previousCount?: number;
    }
  >({
    mutationFn: () => api.post('/api/v1/notifications/read-all'),
    onMutate: async () => {
      const allKey = queryKeys.notifications.list({ unreadOnly: false });
      const unreadKey = queryKeys.notifications.list({ unreadOnly: true });
      const countKey = queryKeys.notifications.unreadCount();
      await queryClient.cancelQueries({ queryKey: allKey });
      await queryClient.cancelQueries({ queryKey: unreadKey });
      await queryClient.cancelQueries({ queryKey: countKey });
      const previousAll = getInfinite(queryClient, allKey);
      const previousUnread = getInfinite(queryClient, unreadKey);
      const previousCount = queryClient.getQueryData<number>(countKey) ?? 0;
      queryClient.setQueryData(allKey, mapInfiniteAll(previousAll));
      queryClient.setQueryData(unreadKey, mapInfiniteAll(previousUnread));
      queryClient.setQueryData(countKey, 0);
      return { previousAll, previousUnread, previousCount };
    },
    onError: (_err, _v, ctx) => {
      if (!ctx) return;
      queryClient.setQueryData(
        queryKeys.notifications.list({ unreadOnly: false }),
        ctx.previousAll,
      );
      queryClient.setQueryData(
        queryKeys.notifications.list({ unreadOnly: true }),
        ctx.previousUnread,
      );
      queryClient.setQueryData(
        queryKeys.notifications.unreadCount(),
        ctx.previousCount,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
    },
  });

  // ── Click handlers ───────────────────────────────────────────────────
  const handleItemClick = React.useCallback(
    (item: NotificationItem) => {
      if (!item.read) {
        markReadMutation.mutate(item.id);
      }
      if (item.objectId) {
        setOpen(false);
        router.push(`/objects/${item.objectId}`);
      }
    },
    [markReadMutation, router],
  );

  const handleMarkAllRead = React.useCallback(() => {
    markAllReadMutation.mutate();
  }, [markAllReadMutation]);

  const visibleUnread = unreadCountQuery.data ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent align="end" sideOffset={8} className="w-[380px] p-0">
        <NotificationPanelBody
          filter={filter}
          onFilterChange={setFilter}
          pages={listQuery.data?.pages.map((p) => p.data) ?? []}
          unreadCount={visibleUnread}
          isPending={listQuery.isPending && open}
          isError={listQuery.isError}
          hasNextPage={listQuery.hasNextPage}
          isFetchingNextPage={listQuery.isFetchingNextPage}
          onLoadMore={() => listQuery.fetchNextPage()}
          onItemClick={handleItemClick}
          onMarkAllRead={handleMarkAllRead}
        />
        <footer className="flex items-center justify-between border-t border-border px-3 py-2">
          <Link
            href="/admin/notices"
            className="text-xs text-fg-muted hover:text-fg hover:underline"
          >
            모든 알림 보기
          </Link>
          <Link
            href="/settings"
            aria-label="알림 설정"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Link>
        </footer>
      </PopoverContent>
    </Popover>
  );
}

// ── Cache helpers (typed `setQueryData` for `useInfiniteQuery`) ───────────

interface InfinitePages {
  pages: NotificationListEnvelope[];
  pageParams: Array<unknown>;
}

function getInfinite(
  qc: ReturnType<typeof useQueryClient>,
  key: readonly unknown[],
): InfinitePages | undefined {
  return qc.getQueryData<InfinitePages>(key);
}

/** Replace one item's `read` flag across every page in the cache. */
function mapInfinite(
  prev: InfinitePages | undefined,
  id: string,
  read: boolean,
): InfinitePages | undefined {
  if (!prev) return prev;
  return {
    ...prev,
    pages: prev.pages.map((page) => ({
      ...page,
      data: page.data.map((it) => (it.id === id ? { ...it, read } : it)),
    })),
  };
}

/** Mark every item across every page as read. */
function mapInfiniteAll(
  prev: InfinitePages | undefined,
): InfinitePages | undefined {
  if (!prev) return prev;
  return {
    ...prev,
    pages: prev.pages.map((page) => ({
      ...page,
      data: page.data.map((it) => ({ ...it, read: true })),
    })),
  };
}
