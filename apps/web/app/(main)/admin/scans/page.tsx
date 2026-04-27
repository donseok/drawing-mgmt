'use client';

import * as React from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  RefreshCw,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
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
  AttachmentScanBadge,
  type AttachmentScanStatus,
} from '@/components/scan/AttachmentScanBadge';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

/**
 * /admin/scans — R36 V-INF-3 (designer §C / api_contract §3.5).
 *
 * Single-pane admin surface that mirrors /admin/conversions for the ClamAV
 * virus-scan queue:
 *   - 6 stats cards (PENDING / SCANNING / CLEAN / INFECTED / SKIPPED / FAILED)
 *     clickable to filter the table.
 *   - 9-column table (status / 첨부 ID / 도면번호+파일명 / 시그니처 / 검사 시각 /
 *     크기 / mime / 다운로드 / 행 동작).
 *   - 5-second polling while at least one row is SCANNING.
 *   - 재스캔 mutation (POST /api/v1/admin/scans/:id/rescan) with optimistic
 *     state flip to SCANNING + invalidate-on-settle.
 *
 * Endpoint contract (api_contract.md §3.5):
 *   GET  /api/v1/admin/scans?status=&cursor=&limit=
 *     → { data: ScanRow[], meta: { stats: Record<Status, number>,
 *                                  nextCursor: string | null } }
 *   POST /api/v1/admin/scans/:id/rescan         (Phase 2 — already in BE
 *     contract, FE button surfaces it on FAILED + INFECTED rows)
 *
 * NOTE: BE delivery for the /rescan endpoint may trail this page by a round.
 * The mutation degrades gracefully — a 404/501 produces a friendly toast
 * instead of throwing.
 */

// ── Wire shapes ──────────────────────────────────────────────────────────

interface ScanRowDTO {
  attachmentId: string;
  attachmentFilename: string | null;
  attachmentSize: string | null; // BigInt → string in JSON envelope
  attachmentMime: string | null;
  objectId: string | null;
  objectNumber: string | null;
  objectName: string | null;
  virusScanStatus: AttachmentScanStatus;
  virusScanSig: string | null;
  virusScanAt: string | null;
}

type ScanStats = Record<AttachmentScanStatus, number>;

interface ScanListEnvelope {
  ok: true;
  data: ScanRowDTO[];
  meta: {
    stats: ScanStats;
    nextCursor: string | null;
  };
}

const STATUS_ORDER: AttachmentScanStatus[] = [
  'PENDING',
  'SCANNING',
  'CLEAN',
  'INFECTED',
  'SKIPPED',
  'FAILED',
];

const STATUS_LABEL: Record<AttachmentScanStatus, string> = {
  PENDING: '검사 대기',
  SCANNING: '검사 중',
  CLEAN: '안전',
  INFECTED: '감염',
  SKIPPED: '검사 미사용',
  FAILED: '검사 실패',
};

const ZERO_STATS: ScanStats = {
  PENDING: 0,
  SCANNING: 0,
  CLEAN: 0,
  INFECTED: 0,
  SKIPPED: 0,
  FAILED: 0,
};

// Raw fetch (we want the meta envelope; api.get unwraps `data`).
async function fetchScans(params: {
  status?: AttachmentScanStatus;
  cursor?: string;
  limit?: number;
}): Promise<ScanListEnvelope> {
  const url = new URL('/api/v1/admin/scans', window.location.origin);
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
  return parsed as ScanListEnvelope;
}

// ── Formatters ───────────────────────────────────────────────────────────

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

function formatBytes(input: string | number | null): string {
  if (input === null || input === undefined) return '—';
  const n = typeof input === 'string' ? Number(input) : input;
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function ScansPage(): JSX.Element {
  const queryClient = useQueryClient();

  // URL-synced filter state — local to the page session for now (mirrors
  // /admin/conversions). When this grows we can move it to URL params.
  const [statusFilter, setStatusFilter] = React.useState<'ALL' | AttachmentScanStatus>(
    'ALL',
  );
  // Client-side substring search across attachment id, filename, object number.
  // The BE endpoint per contract §3.5 doesn't accept `q` today, so we filter the
  // currently loaded buffer.
  const [textQuery, setTextQuery] = React.useState('');
  const [autoRefresh, setAutoRefresh] = useLocalStorage<boolean>(
    'scans.autoRefresh',
    true,
  );

  // Cursor-paginated buffer — we accumulate pages client-side to keep page-0
  // polling stable. Filter changes drop the buffer.
  const [pages, setPages] = React.useState<ScanRowDTO[][]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPages([]);
    setNextCursor(null);
  }, [statusFilter]);

  // Page-0 list query. Polls when SCANNING > 0 (live work in flight). Static
  // states (CLEAN/INFECTED/SKIPPED/FAILED) don't trigger polling — admin can
  // hit the refresh button or change filter to refetch.
  const listQuery = useQuery<ScanListEnvelope, ApiError>({
    queryKey: queryKeys.admin.scans({
      status: statusFilter === 'ALL' ? undefined : statusFilter,
    }),
    queryFn: () =>
      fetchScans({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        limit: 50,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      if (!autoRefresh) return false;
      const stats = query.state.data?.meta.stats;
      if (!stats) return 5000;
      // PENDING also implies upcoming work, but jobs typically transition out
      // of PENDING within a few BullMQ ticks; SCANNING is the unambiguous
      // "actively burning CPU on a clamscan child" signal.
      return stats.SCANNING > 0 || stats.PENDING > 0 ? 5000 : false;
    },
    refetchIntervalInBackground: false,
  });

  // Refetch on tab focus return — React Query already does this via
  // refetchOnWindowFocus, but explicit is friendlier when the tab has been
  // hidden long enough that polling stopped.
  React.useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && autoRefresh) {
        void listQuery.refetch();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [autoRefresh, listQuery]);

  React.useEffect(() => {
    if (listQuery.data) {
      setNextCursor(listQuery.data.meta.nextCursor);
    }
  }, [listQuery.data]);

  const stats: ScanStats = listQuery.data?.meta.stats ?? ZERO_STATS;

  const loadMore = React.useCallback(async () => {
    if (!nextCursor) return;
    try {
      const env = await fetchScans({
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

  const allRows = React.useMemo(() => {
    const page0 = listQuery.data?.data ?? [];
    const flat = [...page0, ...pages.flat()];
    if (!textQuery.trim()) return flat;
    const q = textQuery.trim().toLowerCase();
    return flat.filter(
      (r) =>
        r.attachmentId.toLowerCase().includes(q) ||
        (r.attachmentFilename ?? '').toLowerCase().includes(q) ||
        (r.objectNumber ?? '').toLowerCase().includes(q) ||
        (r.virusScanSig ?? '').toLowerCase().includes(q),
    );
  }, [listQuery.data, pages, textQuery]);

  // ── Re-scan mutation ────────────────────────────────────────────────────
  // FAILED rows are the canonical retry target (clamscan errored), but the
  // contract also surfaces the /rescan endpoint for INFECTED rows so an admin
  // can re-verify after manually cleaning the file. We optimistically flip
  // the row to SCANNING so the polling loop owns the truth on next poll.
  const rescanMutation = useMutation<
    unknown,
    ApiError,
    { attachmentId: string },
    { prev: ScanListEnvelope | undefined; key: ReturnType<typeof queryKeys.admin.scans> }
  >({
    mutationFn: ({ attachmentId }) =>
      api.post(`/api/v1/admin/scans/${attachmentId}/rescan`),
    onMutate: async (vars) => {
      const key = queryKeys.admin.scans({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
      });
      await queryClient.cancelQueries({ queryKey: ['admin', 'scans'] });
      const prev = queryClient.getQueryData<ScanListEnvelope>(key);
      if (prev) {
        const next: ScanListEnvelope = {
          ...prev,
          data: prev.data.map((r) =>
            r.attachmentId === vars.attachmentId
              ? { ...r, virusScanStatus: 'SCANNING', virusScanSig: null }
              : r,
          ),
        };
        queryClient.setQueryData(key, next);
      }
      return { prev, key };
    },
    onSuccess: () => {
      toast.success('재스캔 큐에 추가되었습니다.');
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
      // Soft-fail when the BE hasn't shipped the endpoint yet — the contract
      // describes it but BE delivery may trail by a round.
      if (err.status === 404 || err.status === 501) {
        toast.warning('재스캔 기능 준비 중', {
          description: 'BE 엔드포인트 배포 후 자동으로 활성화됩니다.',
        });
        return;
      }
      if (err.status === 403) {
        toast.error('재스캔 권한이 없습니다.');
        return;
      }
      if (err.status === 409) {
        toast.warning('이미 검사 중입니다.', { description: err.message });
        return;
      }
      if (err.code === 'E_RATE_LIMIT') {
        toast.error('요청 빈도 제한에 걸렸습니다. 잠시 후 다시 시도하세요.');
        return;
      }
      toast.error('재스캔 실패', { description: err.message });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'scans'] });
    },
  });

  const [rescanTarget, setRescanTarget] = React.useState<ScanRowDTO | null>(null);

  const handleCopySignature = React.useCallback(async (sig: string | null) => {
    if (!sig) return;
    try {
      await navigator.clipboard.writeText(sig);
      toast.success('시그니처를 복사했습니다.');
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  }, []);

  const handleResetFilters = React.useCallback(() => {
    setStatusFilter('ALL');
    setTextQuery('');
  }, []);

  const isAnyFilterActive = statusFilter !== 'ALL' || textQuery.trim() !== '';
  const totalInfected = stats.INFECTED;

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />

      <section className="flex min-w-0 flex-1 flex-col overflow-auto bg-bg">
        {/* Breadcrumb + title */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
          <span className="text-fg-muted">관리자</span>
          <span className="text-fg-subtle">/</span>
          <span className="font-medium text-fg">바이러스 스캔</span>
        </div>

        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <div className="app-kicker">Admin Console</div>
            <h1 className="mt-1 text-2xl font-semibold text-fg">바이러스 스캔</h1>
            <p className="mt-1 text-sm text-fg-muted">
              ClamAV 검사 큐를 모니터링하고 실패한 항목을 재스캔합니다. 감염
              파일은 다운로드/미리보기/인쇄 모두 자동 차단됩니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void listQuery.refetch()}
              disabled={listQuery.isFetching}
              aria-label="새로고침"
              title="새로고침"
            >
              <RefreshCw
                className={cn(
                  'h-4 w-4',
                  listQuery.isFetching && 'animate-spin',
                )}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>

        {/* Banner — INFECTED 1건 이상이면 admin 주의 환기 */}
        {totalInfected > 0 ? (
          <div className="border-b border-rose-200 bg-rose-50/60 px-6 py-3 text-sm dark:border-rose-900/60 dark:bg-rose-950/30">
            <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300">
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="font-medium">
                감염된 첨부가 {totalInfected.toLocaleString()}건 있습니다.
              </span>
              <span className="text-rose-700/80 dark:text-rose-400/90">
                해당 자료는 다운로드/미리보기/인쇄가 자동 차단됩니다.
              </span>
              <button
                type="button"
                onClick={() => setStatusFilter('INFECTED')}
                className="ml-auto rounded-md border border-rose-300 bg-rose-100/70 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-900/50 dark:text-rose-200"
              >
                감염만 보기
              </button>
            </div>
          </div>
        ) : null}

        {/* Stats cards — 6 kinds */}
        <div className="grid grid-cols-2 gap-3 px-6 pt-4 md:grid-cols-3 xl:grid-cols-6">
          {STATUS_ORDER.map((s) => (
            <StatCard
              key={s}
              kind={s}
              label={STATUS_LABEL[s]}
              value={stats[s]}
              active={statusFilter === s}
              pulse={s === 'SCANNING' && stats.SCANNING > 0}
              onClick={() =>
                setStatusFilter((cur) => (cur === s ? 'ALL' : s))
              }
            />
          ))}
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase text-fg-subtle">상태</span>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'ALL' | AttachmentScanStatus)}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체</SelectItem>
                {STATUS_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-1 items-center gap-2">
            <span className="text-xs font-medium uppercase text-fg-subtle">검색</span>
            <Input
              value={textQuery}
              onChange={(e) => setTextQuery(e.target.value)}
              prefix={<Search className="h-4 w-4" aria-hidden="true" />}
              placeholder="첨부 ID, 파일명, 도면번호, 시그니처"
              className="h-8 max-w-sm text-xs"
              aria-label="첨부/도면/시그니처 검색"
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
                    ? '스캔 이력 조회 권한이 없습니다'
                    : '스캔 이력을 불러오지 못했습니다'
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
                icon={isAnyFilterActive ? Search : ShieldCheck}
                title={
                  isAnyFilterActive
                    ? '조건에 맞는 항목이 없습니다'
                    : totalInfected === 0
                      ? '감염된 첨부가 없습니다'
                      : '검사 이력이 없습니다'
                }
                description={
                  !isAnyFilterActive && totalInfected === 0
                    ? 'ClamAV 검사가 비활성화되었거나 첨부가 아직 검사되지 않았습니다.'
                    : undefined
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
                    <th className="w-[120px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      상태
                    </th>
                    <th className="w-[140px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      첨부 ID
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      도면번호 / 파일명
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      시그니처
                    </th>
                    <th className="w-[120px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      검사 시각
                    </th>
                    <th className="w-[100px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      크기
                    </th>
                    <th className="w-[120px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      MIME
                    </th>
                    <th className="w-[110px] px-3 py-2 text-right text-[11px] font-semibold uppercase text-fg-muted">
                      동작
                    </th>
                    <th className="w-[36px] px-1 py-2" aria-label="추가 동작" />
                  </tr>
                </thead>
                <tbody>
                  {allRows.map((row) => (
                    <ScanRow
                      key={row.attachmentId}
                      row={row}
                      onRescanClick={() => setRescanTarget(row)}
                      onCopySignature={handleCopySignature}
                      rescanPending={
                        rescanMutation.isPending &&
                        rescanMutation.variables?.attachmentId === row.attachmentId
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
        open={rescanTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRescanTarget(null);
        }}
        title="재스캔하시겠습니까?"
        description={
          rescanTarget ? (
            <span className="block space-y-1 text-sm">
              <span className="block font-mono-num text-[12px] text-fg">
                첨부 ID: {rescanTarget.attachmentId}
              </span>
              {rescanTarget.objectNumber ? (
                <span className="block font-mono-num text-[12px] text-fg">
                  도면번호: {rescanTarget.objectNumber}
                </span>
              ) : null}
              {rescanTarget.virusScanSig ? (
                <span className="block text-[11px] text-rose-700 dark:text-rose-400">
                  마지막 시그니처: {rescanTarget.virusScanSig}
                </span>
              ) : null}
              <span className="block text-[11px] text-fg-muted">
                ClamAV가 즉시 재검사합니다.
              </span>
            </span>
          ) : undefined
        }
        confirmText="재스캔"
        onConfirm={async () => {
          if (!rescanTarget) return;
          await rescanMutation.mutateAsync({
            attachmentId: rescanTarget.attachmentId,
          });
          setRescanTarget(null);
        }}
      />
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────

interface StatCardProps {
  kind: AttachmentScanStatus;
  label: string;
  value: number;
  active: boolean;
  pulse?: boolean;
  onClick: () => void;
}

const STAT_BORDER: Record<AttachmentScanStatus, string> = {
  PENDING: 'border-l-slate-400',
  SCANNING: 'border-l-sky-400',
  CLEAN: 'border-l-emerald-400',
  INFECTED: 'border-l-rose-500',
  SKIPPED: 'border-l-slate-300',
  FAILED: 'border-l-amber-500',
};

const STAT_DOT: Record<AttachmentScanStatus, string> = {
  PENDING: 'bg-slate-400',
  SCANNING: 'bg-sky-500',
  CLEAN: 'bg-emerald-500',
  INFECTED: 'bg-rose-500',
  SKIPPED: 'bg-slate-300',
  FAILED: 'bg-amber-500',
};

function StatCard({
  kind,
  label,
  value,
  active,
  pulse,
  onClick,
}: StatCardProps): JSX.Element {
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
        <span className="text-[11px] font-medium uppercase text-fg-subtle">
          {kind}
        </span>
      </div>
      <span className="text-2xl font-semibold tabular-nums text-fg">
        {value.toLocaleString()}
      </span>
      <span className="text-xs text-fg-muted">{label}</span>
    </button>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────

interface ScanRowProps {
  row: ScanRowDTO;
  onRescanClick: () => void;
  onCopySignature: (sig: string | null) => Promise<void>;
  rescanPending: boolean;
}

function ScanRow({
  row,
  onRescanClick,
  onCopySignature,
  rescanPending,
}: ScanRowProps): JSX.Element {
  // Re-scan is sensible from FAILED (retry the worker) and INFECTED (admin
  // claims the file is now clean). PENDING / SCANNING are already in flight.
  // CLEAN / SKIPPED have nothing to retry.
  const canRescan =
    row.virusScanStatus === 'FAILED' || row.virusScanStatus === 'INFECTED';

  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-bg-subtle',
        row.virusScanStatus === 'SCANNING' &&
          'bg-sky-50/40 shadow-[inset_2px_0_0] shadow-sky-400 dark:bg-sky-950/20',
        row.virusScanStatus === 'INFECTED' &&
          'bg-rose-50/40 shadow-[inset_2px_0_0] shadow-rose-500 dark:bg-rose-950/20',
        row.virusScanStatus === 'FAILED' &&
          'bg-amber-50/40 shadow-[inset_2px_0_0] shadow-amber-400 dark:bg-amber-950/20',
        row.virusScanStatus === 'CLEAN' &&
          'shadow-[inset_2px_0_0] shadow-emerald-400/60',
        row.virusScanStatus === 'PENDING' &&
          'shadow-[inset_2px_0_0] shadow-slate-300',
      )}
    >
      <td className="px-3 py-2 align-middle">
        <AttachmentScanBadge
          status={row.virusScanStatus}
          signature={row.virusScanSig}
        />
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className="font-mono-num text-[11px] text-fg"
          title={row.attachmentId}
        >
          {row.attachmentId.slice(0, 12)}…
        </span>
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="min-w-0 max-w-[420px]">
          {row.objectNumber ? (
            <div className="font-mono-num text-[12px] text-fg">
              {row.objectNumber}
            </div>
          ) : null}
          <div className="truncate text-xs text-fg-muted">
            {row.objectName ?? row.attachmentFilename ?? '—'}
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        {row.virusScanSig ? (
          <button
            type="button"
            onClick={() => void onCopySignature(row.virusScanSig)}
            className={cn(
              'inline-flex items-center gap-1 rounded-sm text-left text-xs text-rose-700 hover:underline dark:text-rose-400',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            title={row.virusScanSig}
            aria-label="시그니처 복사"
          >
            <ClipboardCopy className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="max-w-[260px] truncate">{row.virusScanSig}</span>
          </button>
        ) : (
          <span className="text-xs text-fg-subtle">—</span>
        )}
      </td>
      <td className="px-3 py-2 align-middle font-mono-num text-[12px] text-fg-muted">
        {formatTimestamp(row.virusScanAt)}
      </td>
      <td className="px-3 py-2 align-middle font-mono-num text-[12px] text-fg-muted">
        {formatBytes(row.attachmentSize)}
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className="inline-block max-w-[120px] truncate font-mono text-[11px] text-fg-muted"
          title={row.attachmentMime ?? undefined}
        >
          {row.attachmentMime ?? '—'}
        </span>
      </td>
      <td className="px-3 py-2 text-right align-middle">
        <Button
          size="sm"
          variant="outline"
          onClick={onRescanClick}
          disabled={!canRescan || rescanPending}
          aria-label={canRescan ? '재스캔' : '재스캔 불가'}
          className="h-7 px-2"
        >
          {rescanPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          재스캔
        </Button>
      </td>
      <td className="px-1 py-2 text-center align-middle">
        {row.objectId ? (
          // Detail page deeplink — admin can jump to the affected object.
          // We use a plain anchor (not next/link) so we keep the surface
          // self-contained without dragging in next/link here.
          <a
            href={`/objects/${row.objectId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="app-icon-button inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
            aria-label="자료 상세 새 탭에서 열기"
            title="자료 상세 새 탭에서 열기"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </td>
    </tr>
  );
}
