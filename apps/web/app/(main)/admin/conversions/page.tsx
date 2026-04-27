'use client';

import * as React from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Loader2,
  RefreshCw,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { AdminSidebar } from '@/app/(main)/admin/AdminSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  ConversionStatusBadge,
  type ConversionJobStatus,
} from '@/components/conversion/ConversionStatusBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

/**
 * /admin/conversions — DESIGN r28 §B.
 *
 * Single-pane page that lists ConversionJob rows (BullMQ surface) with stats
 * cards, filter bar, retry flow, and 5-second polling while at least one job
 * is PENDING or PROCESSING.
 *
 * Endpoint contract — api_contract.md §4.3:
 *   GET  /api/v1/admin/conversions/jobs?status=&cursor=&limit=
 *   POST /api/v1/admin/conversions/jobs/:id/retry
 * Response carries inline `meta.stats` so the cards don't need a separate
 * stats endpoint.
 */

// ── Wire shapes ──────────────────────────────────────────────────────────
interface ConversionJobDTO {
  id: string;
  attachmentId: string;
  attachmentFilename: string | null;
  objectId?: string | null;
  objectNumber?: string | null;
  objectName?: string | null;
  status: ConversionJobStatus;
  attempt: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  durationMs: number | null;
}

interface ConversionStats {
  PENDING: number;
  PROCESSING: number;
  DONE: number;
  FAILED: number;
}

interface ConversionListEnvelope {
  ok: true;
  data: ConversionJobDTO[];
  meta: {
    stats: ConversionStats;
    nextCursor: string | null;
  };
}

const MAX_ATTEMPTS = 3;

// fetch directly to grab the meta envelope (api.get unwraps `data`).
async function fetchConversionJobs(params: {
  status?: ConversionJobStatus;
  cursor?: string;
  limit?: number;
}): Promise<ConversionListEnvelope> {
  const url = new URL('/api/v1/admin/conversions/jobs', window.location.origin);
  if (params.status) url.searchParams.set('status', params.status);
  if (params.cursor) url.searchParams.set('cursor', params.cursor);
  url.searchParams.set('limit', String(params.limit ?? 50));
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
    const env = (parsed as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(env?.message ?? `Request failed (${res.status})`, {
      code: env?.code,
      status: res.status,
    });
  }
  return parsed as ConversionListEnvelope;
}

// Format the createdAt/startedAt cell. Today gets HH:mm:ss; older rows get M/D HH:mm.
function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  if (same) {
    return d.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${d
    .getHours()
    .toString()
    .padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatDurationMs(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min}m` : `${min}m${sec}s`;
}

export default function ConversionsPage(): JSX.Element {
  const queryClient = useQueryClient();

  // ── URL-synced filter state ────────────────────────────────────────────
  // We use plain useState (not useSearchParams) for simplicity; the filter
  // state is local to the page session. When this grows we can move to URL.
  const [statusFilter, setStatusFilter] = React.useState<'ALL' | ConversionJobStatus>(
    'ALL',
  );
  // attachmentId filter is a client-side substring match for now (BE endpoint
  // doesn't accept it per contract §4.3). Falls under "phase 2" per spec §B.4.
  const [attachmentQuery, setAttachmentQuery] = React.useState('');
  const [autoRefresh, setAutoRefresh] = useLocalStorage<boolean>(
    'conversions.autoRefresh',
    true,
  );

  // ── Pagination state (cursor) ──────────────────────────────────────────
  // We accumulate pages client-side. Filter changes reset the buffer.
  const [pages, setPages] = React.useState<ConversionJobDTO[][]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [page0Cursor, setPage0Cursor] = React.useState<string | undefined>(undefined);

  // Reset accumulated pages when the status filter changes — page 0 is the
  // only one that polls, and stale loaded pages don't reflect the new filter.
  React.useEffect(() => {
    setPages([]);
    setPage0Cursor(undefined);
    setNextCursor(null);
  }, [statusFilter]);

  // ── Listing query (page 0) ─────────────────────────────────────────────
  // Polling happens here so refetches always target the freshest page.
  // The `refetchInterval` callback receives the live `Query` instance so we
  // can inspect the latest response without referencing `listQuery` directly
  // (TS would complain about the self-reference inside the initializer).
  const listQuery = useQuery<ConversionListEnvelope, ApiError>({
    queryKey: queryKeys.admin.conversions({
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      cursor: page0Cursor,
    }),
    queryFn: () =>
      fetchConversionJobs({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        cursor: page0Cursor,
        limit: 50,
      }),
    placeholderData: keepPreviousData, // v5 — see frontend.md §4
    refetchInterval: (query) => {
      if (!autoRefresh) return false;
      const stats = query.state.data?.meta.stats;
      if (!stats) return 5000; // bootstrap — keep polling until we know
      return stats.PENDING + stats.PROCESSING > 0 ? 5000 : false;
    },
    refetchIntervalInBackground: false,
  });

  // Pause polling when the tab is hidden (Visibility API). React Query already
  // does this via `refetchOnWindowFocus`, but explicit guard makes intent
  // visible to readers and shields against bursts when the tab returns.
  React.useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && autoRefresh) {
        void listQuery.refetch();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [autoRefresh, listQuery]);

  // Stats come inline with each list response. Default to zeros while loading.
  const stats: ConversionStats = listQuery.data?.meta.stats ?? {
    PENDING: 0,
    PROCESSING: 0,
    DONE: 0,
    FAILED: 0,
  };

  // ── More-pages mutation (manual cursor). We don't use useInfiniteQuery
  // because polling is page 0-only; older pages are append-only and do not
  // need to refetch on the same interval.
  const loadMore = React.useCallback(async () => {
    if (!nextCursor) return;
    try {
      const env = await fetchConversionJobs({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        cursor: nextCursor,
        limit: 50,
      });
      setPages((prev) => [...prev, env.data]);
      setNextCursor(env.meta.nextCursor);
    } catch (err) {
      const e = err as ApiError;
      toast.error('추가 로딩 실패', { description: e.message });
    }
  }, [nextCursor, statusFilter]);

  // Track page 0 cursor when the first list arrives (so loadMore knows where
  // to continue from). We DON'T set `page0Cursor` from the response — page 0
  // always uses `cursor=undefined` so polling is stable. We just store the
  // server's `nextCursor` for the load-more button.
  React.useEffect(() => {
    if (listQuery.data) {
      setNextCursor(listQuery.data.meta.nextCursor);
    }
  }, [listQuery.data]);

  // ── All visible rows: page 0 + accumulated load-more pages, then client
  // filter on attachmentId substring. ────────────────────────────────────
  const allRows = React.useMemo(() => {
    const page0 = listQuery.data?.data ?? [];
    const flat = [...page0, ...pages.flat()];
    if (!attachmentQuery.trim()) return flat;
    const q = attachmentQuery.trim().toLowerCase();
    return flat.filter(
      (r) =>
        r.attachmentId.toLowerCase().includes(q) ||
        (r.attachmentFilename ?? '').toLowerCase().includes(q) ||
        (r.objectNumber ?? '').toLowerCase().includes(q),
    );
  }, [listQuery.data, pages, attachmentQuery]);

  // ── Retry mutation ─────────────────────────────────────────────────────
  const retryMutation = useMutation<unknown, ApiError, { jobId: string }>({
    mutationFn: ({ jobId }) =>
      api.post(`/api/v1/admin/conversions/jobs/${jobId}/retry`),
    onSuccess: () => {
      toast.success('재시도 큐에 추가되었습니다.');
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'conversions', 'jobs'],
      });
    },
    onError: (err) => {
      if (err.status === 409) {
        toast.warning('이미 처리 중인 작업입니다.', { description: err.message });
      } else if (err.status === 404) {
        toast.error('작업을 찾을 수 없습니다 (삭제되었을 수 있습니다).');
      } else if (err.code === 'E_RATE_LIMIT') {
        toast.error('요청 빈도 제한에 걸렸습니다. 잠시 후 다시 시도하세요.');
      } else {
        toast.error('재시도 실패', { description: err.message });
      }
    },
  });

  // ── UI state ───────────────────────────────────────────────────────────
  const [retryTarget, setRetryTarget] = React.useState<ConversionJobDTO | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const handleResetFilters = React.useCallback(() => {
    setStatusFilter('ALL');
    setAttachmentQuery('');
  }, []);

  const handleCopyError = React.useCallback(async (msg: string | null) => {
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(msg);
      toast.success('클립보드에 복사되었습니다.');
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  }, []);

  const isAnyFilterActive = statusFilter !== 'ALL' || attachmentQuery.trim() !== '';

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />

      <section className="flex min-w-0 flex-1 flex-col overflow-auto bg-bg">
        {/* Breadcrumb + title */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
          <span className="text-fg-muted">관리자</span>
          <span className="text-fg-subtle">/</span>
          <span className="font-medium text-fg">변환 작업</span>
        </div>

        <div className="border-b border-border px-6 py-5">
          <div className="app-kicker">Admin Console</div>
          <h1 className="mt-1 text-2xl font-semibold text-fg">변환 작업</h1>
          <p className="mt-1 text-sm text-fg-muted">
            DWG → DXF/PDF/SVG 변환 큐를 모니터링하고 실패 작업을 재시도합니다.
          </p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 gap-3 px-6 pt-4 md:grid-cols-4">
          <StatCard
            label="대기 중"
            value={stats.PENDING}
            kind="PENDING"
            active={statusFilter === 'PENDING'}
            onClick={() =>
              setStatusFilter((cur) => (cur === 'PENDING' ? 'ALL' : 'PENDING'))
            }
          />
          <StatCard
            label="처리 중"
            value={stats.PROCESSING}
            kind="PROCESSING"
            active={statusFilter === 'PROCESSING'}
            pulse={stats.PROCESSING > 0}
            onClick={() =>
              setStatusFilter((cur) => (cur === 'PROCESSING' ? 'ALL' : 'PROCESSING'))
            }
          />
          <StatCard
            label="완료"
            value={stats.DONE}
            kind="DONE"
            active={statusFilter === 'DONE'}
            onClick={() =>
              setStatusFilter((cur) => (cur === 'DONE' ? 'ALL' : 'DONE'))
            }
          />
          <StatCard
            label="실패"
            value={stats.FAILED}
            kind="FAILED"
            active={statusFilter === 'FAILED'}
            onClick={() =>
              setStatusFilter((cur) => (cur === 'FAILED' ? 'ALL' : 'FAILED'))
            }
          />
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase text-fg-subtle">상태</span>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'ALL' | ConversionJobStatus)}
            >
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체</SelectItem>
                <SelectItem value="PENDING">대기 중</SelectItem>
                <SelectItem value="PROCESSING">처리 중</SelectItem>
                <SelectItem value="DONE">완료</SelectItem>
                <SelectItem value="FAILED">실패</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-1 items-center gap-2">
            <span className="text-xs font-medium uppercase text-fg-subtle">검색</span>
            <Input
              value={attachmentQuery}
              onChange={(e) => setAttachmentQuery(e.target.value)}
              prefix={<Search className="h-4 w-4" aria-hidden="true" />}
              placeholder="첨부 ID, 파일명, 도면번호"
              className="h-8 max-w-sm text-xs"
              aria-label="첨부/도면 검색"
            />
          </div>

          {isAnyFilterActive ? (
            <Button size="sm" variant="ghost" onClick={handleResetFilters}>
              <X className="h-4 w-4" /> 필터 초기화
            </Button>
          ) : null}

          <label className="ml-auto inline-flex h-8 items-center gap-2 rounded-md border border-border bg-bg px-3 text-xs text-fg">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              aria-label="5초 자동 새로고침"
              className="h-3.5 w-3.5 rounded border-border"
            />
            <span>5초 자동 새로고침</span>
            {listQuery.isFetching ? (
              <Loader2 className="h-3 w-3 animate-spin text-fg-muted" aria-hidden="true" />
            ) : null}
          </label>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {listQuery.isPending ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : listQuery.isError ? (
            <div className="flex flex-1 items-center justify-center p-10">
              <EmptyState
                icon={AlertCircle}
                title={
                  listQuery.error?.status === 403
                    ? '변환 작업 조회 권한이 없습니다'
                    : '변환 작업을 불러오지 못했습니다'
                }
                description={listQuery.error?.message}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void listQuery.refetch()}
                  >
                    재시도
                  </Button>
                }
              />
            </div>
          ) : allRows.length === 0 ? (
            <div className="flex items-center justify-center p-10">
              <EmptyState
                icon={isAnyFilterActive ? Search : CheckCircle2}
                title={
                  isAnyFilterActive
                    ? '조건에 맞는 작업이 없습니다'
                    : '변환 작업이 없습니다'
                }
                action={
                  isAnyFilterActive ? (
                    <Button size="sm" variant="outline" onClick={handleResetFilters}>
                      필터 초기화
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-bg-subtle shadow-[inset_0_-1px_0] shadow-border">
                  <tr>
                    <th className="w-[100px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      상태
                    </th>
                    <th className="w-[160px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      첨부 ID
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      도면번호 / 파일명
                    </th>
                    <th className="w-[80px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      시도
                    </th>
                    <th className="w-[100px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      시작
                    </th>
                    <th className="w-[80px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      소요
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      에러 메시지
                    </th>
                    <th className="w-[110px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      생성일
                    </th>
                    <th className="w-[44px] px-1 py-2" aria-label="행 동작" />
                  </tr>
                </thead>
                <tbody>
                  {allRows.map((row) => (
                    <ConversionRow
                      key={row.id}
                      row={row}
                      expanded={expandedId === row.id}
                      onToggleExpand={() =>
                        setExpandedId((cur) => (cur === row.id ? null : row.id))
                      }
                      onRetryClick={() => setRetryTarget(row)}
                      onCopyError={handleCopyError}
                      retryPending={
                        retryMutation.isPending &&
                        retryMutation.variables?.jobId === row.id
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Load more */}
        {nextCursor ? (
          <div className="flex items-center justify-center border-t border-border bg-bg-subtle py-3">
            <Button
              size="sm"
              variant="outline"
              onClick={loadMore}
              disabled={listQuery.isFetching}
            >
              <RotateCw className="h-4 w-4" /> 더 보기
            </Button>
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={retryTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRetryTarget(null);
        }}
        title="이 변환을 재시도하시겠습니까?"
        description={
          retryTarget ? (
            <span className="block space-y-1 text-sm">
              <span className="block font-mono-num text-[12px] text-fg">
                첨부 ID: {retryTarget.attachmentId}
              </span>
              {retryTarget.objectNumber ? (
                <span className="block font-mono-num text-[12px] text-fg">
                  도면번호: {retryTarget.objectNumber}
                </span>
              ) : null}
              {retryTarget.errorMessage ? (
                <span className="block max-h-24 overflow-auto whitespace-pre-wrap text-[11px] text-rose-700 dark:text-rose-400">
                  {retryTarget.errorMessage}
                </span>
              ) : null}
            </span>
          ) : undefined
        }
        confirmText="재시도"
        onConfirm={async () => {
          if (!retryTarget) return;
          await retryMutation.mutateAsync({ jobId: retryTarget.id });
          setRetryTarget(null);
        }}
      />
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: number;
  kind: ConversionJobStatus;
  active: boolean;
  pulse?: boolean;
  onClick: () => void;
}

const STAT_BORDER: Record<ConversionJobStatus, string> = {
  PENDING: 'border-l-slate-400',
  PROCESSING: 'border-l-sky-400',
  DONE: 'border-l-emerald-400',
  FAILED: 'border-l-rose-500',
};

const STAT_DOT: Record<ConversionJobStatus, string> = {
  PENDING: 'bg-slate-400',
  PROCESSING: 'bg-sky-500',
  DONE: 'bg-emerald-500',
  FAILED: 'bg-rose-500',
};

function StatCard({ label, value, kind, active, pulse, onClick }: StatCardProps): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-1 rounded-md border border-border border-l-4 bg-bg p-4 text-left transition-colors',
        STAT_BORDER[kind],
        'hover:border-border-strong hover:bg-bg-subtle',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-bg-subtle ring-2 ring-brand/40',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-2 w-2 rounded-full',
            STAT_DOT[kind],
            pulse && 'animate-pulse',
          )}
        />
        <span className="text-xs font-medium uppercase text-fg-subtle">{kind}</span>
      </div>
      <span className="text-2xl font-semibold tabular-nums text-fg">{value.toLocaleString()}</span>
      <span className="text-xs text-fg-muted">{label}</span>
    </button>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────
interface ConversionRowProps {
  row: ConversionJobDTO;
  expanded: boolean;
  onToggleExpand: () => void;
  onRetryClick: () => void;
  onCopyError: (msg: string | null) => Promise<void>;
  retryPending: boolean;
}

function ConversionRow({
  row,
  expanded,
  onToggleExpand,
  onRetryClick,
  onCopyError,
  retryPending,
}: ConversionRowProps): JSX.Element {
  const canRetry = row.status === 'FAILED';

  // PM-DECISION-3: spec defaults to text display when objectId is missing.
  // We render a plain span; if the BE later adds objectId we surface a Link.
  // Today, the contract surfaces objectNumber but no objectId guaranteed.
  return (
    <>
      <tr
        className={cn(
          'border-b border-border transition-colors hover:bg-bg-subtle',
          row.status === 'PROCESSING' &&
            'bg-sky-50/40 shadow-[inset_2px_0_0] shadow-sky-400 dark:bg-sky-950/20',
          row.status === 'FAILED' &&
            'bg-rose-50/40 shadow-[inset_2px_0_0] shadow-rose-400 dark:bg-rose-950/20',
          row.status === 'DONE' && 'shadow-[inset_2px_0_0] shadow-emerald-400/60',
          row.status === 'PENDING' && 'shadow-[inset_2px_0_0] shadow-slate-300',
        )}
      >
        <td className="px-3 py-2 align-middle">
          <ConversionStatusBadge status={row.status} />
        </td>
        <td className="px-3 py-2 align-middle">
          <span className="font-mono-num text-[11px] text-fg" title={row.attachmentId}>
            {row.attachmentId.slice(0, 12)}…
          </span>
        </td>
        <td className="px-3 py-2 align-middle">
          <div className="min-w-0 max-w-[420px]">
            {row.objectNumber ? (
              <div className="font-mono-num text-[12px] text-fg">{row.objectNumber}</div>
            ) : null}
            <div className="truncate text-xs text-fg-muted">
              {row.objectName ?? row.attachmentFilename ?? '—'}
            </div>
          </div>
        </td>
        <td className="px-3 py-2 align-middle font-mono-num text-[12px] text-fg-muted">
          {row.attempt}/{MAX_ATTEMPTS}
        </td>
        <td className="px-3 py-2 align-middle font-mono-num text-[12px] text-fg-muted">
          {formatTimestamp(row.startedAt)}
        </td>
        <td className="px-3 py-2 align-middle font-mono-num text-[12px] text-fg-muted">
          {formatDurationMs(row.durationMs)}
        </td>
        <td className="px-3 py-2 align-middle">
          {row.errorMessage ? (
            <button
              type="button"
              onClick={onToggleExpand}
              aria-expanded={expanded}
              aria-controls={`conv-err-${row.id}`}
              className={cn(
                'flex max-w-[360px] items-center gap-1 truncate text-left text-xs text-rose-700 hover:underline dark:text-rose-400',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm',
              )}
              title={row.errorMessage}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{row.errorMessage}</span>
            </button>
          ) : (
            <span className="text-xs text-fg-subtle">—</span>
          )}
        </td>
        <td className="px-3 py-2 align-middle font-mono-num text-[11px] text-fg-muted">
          {formatTimestamp(row.createdAt)}
        </td>
        <td className="px-1 py-2 align-middle text-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label="행 동작"
                disabled={retryPending}
              >
                {retryPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <span aria-hidden="true">⋮</span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={onRetryClick}
                disabled={!canRetry}
              >
                <RefreshCw className="h-4 w-4" /> 재시도
              </DropdownMenuItem>
              {row.errorMessage ? (
                <DropdownMenuItem onSelect={() => void onCopyError(row.errorMessage)}>
                  <ClipboardCopy className="h-4 w-4" /> 에러 복사
                </DropdownMenuItem>
              ) : null}
              {row.attachmentId ? (
                <DropdownMenuItem
                  onSelect={() => {
                    window.open(
                      `/api/v1/attachments/${row.attachmentId}/meta`,
                      '_blank',
                      'noopener',
                    );
                  }}
                >
                  <Activity className="h-4 w-4" /> 첨부 메타 보기
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>
      {expanded && row.errorMessage ? (
        <tr id={`conv-err-${row.id}`} className="bg-rose-50/40 dark:bg-rose-950/20">
          <td colSpan={9} className="px-6 py-3">
            <div className="flex items-start justify-between gap-4">
              <pre className="max-h-64 max-w-full overflow-auto rounded-md border border-rose-200 bg-rose-50/60 p-3 text-[12px] font-mono leading-relaxed text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                {row.errorMessage}
              </pre>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void onCopyError(row.errorMessage)}
              >
                <ClipboardCopy className="h-4 w-4" /> 복사
              </Button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
