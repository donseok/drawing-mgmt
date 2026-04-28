'use client';

/**
 * /admin/pdf-extracts — R41 A 카드.
 *
 * PDF 본문 추출(`pdf-extract` BullMQ worker) 모니터링 + 영구 실패 row 재시도.
 * 패턴은 `/admin/scans` (R36 V-INF-3) 그대로 미러:
 *   - 5종 카운트 카드(PENDING/EXTRACTING/DONE/FAILED/SKIPPED) — 클릭 시 필터
 *   - 상태 select + 검색 input + "5초 자동 새로고침" 토글
 *   - 테이블: 상태 / 자료번호 / 파일명 / 본문 길이 / 마지막 시도 / 오류 / MIME / [재시도]
 *   - 재시도: FAILED + SKIPPED만 활성, ConfirmDialog로 확인 (designer §I.7)
 *   - optimistic flip(PENDING) → 폴링이 EXTRACTING → DONE/FAILED로 자연 갱신
 *
 * 디자이너 spec: docs/_specs/r41_admin_pdf_extracts_vuln_table.md §A.
 * API 계약: _workspace_r41/api_contract.md §4.1 (GET) + §4.2 (retry POST).
 */

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
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
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { ApiError } from '@/lib/api-client';
import {
  queryKeys,
  useAdminPdfExtracts,
  type PdfExtractCounts,
  type PdfExtractListEnvelope,
  type PdfExtractRow,
  type PdfExtractStatus,
} from '@/lib/queries';
import { cn } from '@/lib/cn';

// ── Constants ────────────────────────────────────────────────────────────

const STATUS_ORDER: PdfExtractStatus[] = [
  'PENDING',
  'EXTRACTING',
  'DONE',
  'FAILED',
  'SKIPPED',
];

const STATUS_LABEL: Record<PdfExtractStatus, string> = {
  PENDING: '대기',
  EXTRACTING: '추출 중',
  DONE: '완료',
  FAILED: '실패',
  SKIPPED: '제외',
};

const ZERO_COUNTS: PdfExtractCounts = {
  PENDING: 0,
  EXTRACTING: 0,
  DONE: 0,
  FAILED: 0,
  SKIPPED: 0,
};

// Status-specific border-l + dot classes (designer §A.3 / §E.3).
const STAT_BORDER: Record<PdfExtractStatus, string> = {
  PENDING: 'border-l-slate-400',
  EXTRACTING: 'border-l-sky-400',
  DONE: 'border-l-emerald-400',
  FAILED: 'border-l-rose-500',
  SKIPPED: 'border-l-slate-300',
};

const STAT_DOT: Record<PdfExtractStatus, string> = {
  PENDING: 'bg-slate-400',
  EXTRACTING: 'bg-sky-500',
  DONE: 'bg-emerald-500',
  FAILED: 'bg-rose-500',
  SKIPPED: 'bg-slate-300',
};

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

// ── URL sync helpers (R42 B) ─────────────────────────────────────────────

const VALID_STATUSES = new Set<PdfExtractStatus>(STATUS_ORDER);

/**
 * Parse `?status=` query param into a valid `PdfExtractStatus`. Anything else
 * (missing, empty, unknown casing) collapses to `'ALL'`. Per contract §3.3
 * invalid values are silently ignored — we don't bounce the URL, we just stay
 * idle so refresh-with-typo behaves sanely.
 */
function parseStatusParam(raw: string | null): 'ALL' | PdfExtractStatus {
  if (!raw) return 'ALL';
  const upper = raw.toUpperCase() as PdfExtractStatus;
  return VALID_STATUSES.has(upper) ? upper : 'ALL';
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function PdfExtractsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  // R42 B — mount-time hydrate from `?status=`. Subsequent state changes
  // re-write the URL via `router.replace` (push would polute history on
  // every card toggle).
  const [statusFilter, setStatusFilter] = React.useState<'ALL' | PdfExtractStatus>(
    () => parseStatusParam(searchParams?.get('status') ?? null),
  );

  // Mirror state → URL. We use `replace` (not `push`) so card toggles don't
  // grow the history stack. The pattern (URLSearchParams.toString) matches
  // search/page.tsx:597.
  React.useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() ?? '');
    if (statusFilter === 'ALL') {
      sp.delete('status');
    } else {
      sp.set('status', statusFilter);
    }
    const qs = sp.toString();
    const next = qs ? `/admin/pdf-extracts?${qs}` : '/admin/pdf-extracts';
    // Only replace when the canonical URL actually differs — avoids tight
    // re-render loops if some other effect re-renders the page without
    // changing the filter.
    const cur = `${window.location.pathname}${window.location.search}`;
    if (cur !== next) {
      router.replace(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);
  // Client-side substring search across object number, filename, error msg.
  // The BE doesn't accept `q`, so we filter the loaded buffer.
  const [textQuery, setTextQuery] = React.useState('');
  const [autoRefresh, setAutoRefresh] = useLocalStorage<boolean>(
    'pdfExtracts.autoRefresh',
    true,
  );

  // Cursor-paginated buffer — same pattern as /admin/scans. Filter changes
  // drop the buffer.
  const [pages, setPages] = React.useState<PdfExtractRow[][]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPages([]);
    setNextCursor(null);
  }, [statusFilter]);

  const listQuery = useAdminPdfExtracts({
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    autoRefresh,
  });

  // Refetch on tab focus return.
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

  const counts: PdfExtractCounts = listQuery.data?.meta.counts ?? ZERO_COUNTS;

  const loadMore = React.useCallback(async () => {
    if (!nextCursor) return;
    try {
      const url = new URL(
        '/api/v1/admin/pdf-extracts',
        window.location.origin,
      );
      if (statusFilter !== 'ALL') url.searchParams.set('status', statusFilter);
      url.searchParams.set('cursor', nextCursor);
      url.searchParams.set('limit', '50');
      const res = await fetch(url.toString(), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const text = await res.text();
      const parsed: unknown = text ? JSON.parse(text) : undefined;
      if (!res.ok) {
        const env = (parsed as { error?: { code?: string; message?: string } } | undefined)?.error;
        throw new ApiError(env?.message ?? `Request failed (${res.status})`, {
          code: env?.code,
          status: res.status,
        });
      }
      const env = parsed as PdfExtractListEnvelope;
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
        r.objectNumber.toLowerCase().includes(q) ||
        r.filename.toLowerCase().includes(q) ||
        (r.pdfExtractError ?? '').toLowerCase().includes(q),
    );
  }, [listQuery.data, pages, textQuery]);

  // ── Retry mutation (optimistic flip → PENDING) ─────────────────────────
  const retryMutation = useMutation<
    unknown,
    ApiError,
    { id: string },
    { prev: PdfExtractListEnvelope | undefined; key: ReturnType<typeof queryKeys.admin.pdfExtracts> }
  >({
    mutationFn: ({ id }) =>
      // Reuse the shared mutation hook's request shape (POST + invalidate)
      // but write our own onMutate/onError so we can roll back the optimistic
      // flip. The underlying network call goes through the same endpoint.
      // (We don't call `useRetryPdfExtract().mutate()` here because that
      // hook owns its own queryClient.invalidateQueries — duplicating it
      // wouldn't conflict but the optimistic patch needs to live on this
      // mutation's lifecycle.)
      fetch(`/api/v1/admin/pdf-extracts/${id}/retry`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      }).then(async (res) => {
        const text = await res.text();
        const parsed: unknown = text ? (JSON.parse(text) as unknown) : undefined;
        if (!res.ok) {
          const env = (parsed as { error?: { code?: string; message?: string } } | undefined)?.error;
          throw new ApiError(env?.message ?? `Request failed (${res.status})`, {
            code: env?.code,
            status: res.status,
          });
        }
        return parsed;
      }),
    onMutate: async (vars) => {
      const key = queryKeys.admin.pdfExtracts({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
      });
      await queryClient.cancelQueries({ queryKey: ['admin', 'pdf-extracts'] });
      const prev = queryClient.getQueryData<PdfExtractListEnvelope>(key);
      if (prev) {
        const next: PdfExtractListEnvelope = {
          ...prev,
          data: prev.data.map((r) =>
            r.id === vars.id
              ? { ...r, pdfExtractStatus: 'PENDING', pdfExtractError: null }
              : r,
          ),
        };
        queryClient.setQueryData(key, next);
      }
      return { prev, key };
    },
    onSuccess: () => {
      toast.success('추출 큐에 추가되었습니다.');
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
      if (err.status === 409) {
        toast.warning('현재 상태에서는 재시도할 수 없습니다.', {
          description: err.message,
        });
        return;
      }
      if (err.status === 403) {
        toast.error('재시도 권한이 없습니다.');
        return;
      }
      if (err.status === 404 || err.status === 501) {
        toast.warning('재시도 기능 준비 중', {
          description: 'BE 엔드포인트 배포 후 자동으로 활성화됩니다.',
        });
        return;
      }
      if (err.code === 'E_RATE_LIMIT') {
        toast.error('요청 빈도 제한에 걸렸습니다. 잠시 후 다시 시도하세요.');
        return;
      }
      toast.error('재시도 실패', { description: err.message });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'pdf-extracts'] });
    },
  });

  const [retryTarget, setRetryTarget] = React.useState<PdfExtractRow | null>(null);

  // Note: `useRetryPdfExtract` (lib/queries) is exported as a simpler
  // invalidate-only retry hook for surfaces that don't need optimistic flip.
  // This page wires its own mutation inline so onMutate/onError can roll back
  // the optimistic PENDING flip on 409/403.

  const handleResetFilters = React.useCallback(() => {
    setStatusFilter('ALL');
    setTextQuery('');
  }, []);

  const isAnyFilterActive = statusFilter !== 'ALL' || textQuery.trim() !== '';

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />

      <section className="flex min-w-0 flex-1 flex-col overflow-auto bg-bg">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
          <span className="text-fg-muted">관리자</span>
          <span className="text-fg-subtle">/</span>
          <span className="font-medium text-fg">PDF 본문 추출</span>
        </div>

        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <div className="app-kicker">Admin Console</div>
            <h1 className="mt-1 text-2xl font-semibold text-fg">PDF 본문 추출</h1>
            <p className="mt-1 text-sm text-fg-muted">
              PDF 첨부의 본문 인덱싱 워커 상태와 영구 실패 항목을 모니터링하고
              재시도합니다.
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
                className={cn('h-4 w-4', listQuery.isFetching && 'animate-spin')}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>

        {/* Stats cards — 5 kinds */}
        <div className="grid grid-cols-2 gap-3 px-6 pt-4 md:grid-cols-3 xl:grid-cols-5">
          {STATUS_ORDER.map((s) => (
            <PdfExtractStatCard
              key={s}
              kind={s}
              label={STATUS_LABEL[s]}
              value={counts[s]}
              active={statusFilter === s}
              pulse={s === 'EXTRACTING' && counts.EXTRACTING > 0}
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
              onValueChange={(v) => setStatusFilter(v as 'ALL' | PdfExtractStatus)}
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
              placeholder="자료번호, 파일명, 오류 메시지"
              className="h-8 max-w-sm text-xs"
              aria-label="자료/파일/오류 검색"
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
                    ? '추출 이력 조회 권한이 없습니다'
                    : '추출 이력을 불러오지 못했습니다'
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
                    ? '조건에 맞는 항목이 없습니다'
                    : '처리 대기 중인 PDF가 없습니다'
                }
                description={
                  !isAnyFilterActive
                    ? '모든 PDF의 본문 인덱싱이 완료되었습니다.'
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
                    <th
                      scope="col"
                      className="w-[110px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted"
                    >
                      상태
                    </th>
                    <th
                      scope="col"
                      className="w-[140px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted"
                    >
                      자료번호
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted"
                    >
                      파일명
                    </th>
                    <th
                      scope="col"
                      className="w-[90px] px-3 py-2 text-right text-[11px] font-semibold uppercase text-fg-muted"
                    >
                      본문 길이
                    </th>
                    <th
                      scope="col"
                      className="w-[120px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted"
                    >
                      마지막 시도
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted"
                    >
                      오류 메시지
                    </th>
                    <th
                      scope="col"
                      className="w-[120px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted"
                    >
                      MIME
                    </th>
                    <th
                      scope="col"
                      className="w-[110px] px-3 py-2 text-right text-[11px] font-semibold uppercase text-fg-muted"
                    >
                      동작
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allRows.map((row) => (
                    <PdfExtractTableRow
                      key={row.id}
                      row={row}
                      onRetryClick={() => setRetryTarget(row)}
                      retryPending={
                        retryMutation.isPending &&
                        retryMutation.variables?.id === row.id
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
        title="PDF 본문 추출을 재시도하시겠습니까?"
        description={
          retryTarget ? (
            <span className="block space-y-1 text-sm">
              <span className="block font-mono-num text-[12px] text-fg">
                자료번호: {retryTarget.objectNumber}
              </span>
              <span className="block text-[12px] text-fg-muted">
                파일: {retryTarget.filename}
              </span>
              {retryTarget.pdfExtractError ? (
                <span className="block text-[11px] text-danger">
                  마지막 오류: {retryTarget.pdfExtractError}
                </span>
              ) : null}
              <span className="block text-[11px] text-fg-muted">
                큐에 다시 추가됩니다.
              </span>
            </span>
          ) : undefined
        }
        confirmText="재시도"
        onConfirm={async () => {
          if (!retryTarget) return;
          await retryMutation.mutateAsync({ id: retryTarget.id });
          setRetryTarget(null);
        }}
      />
    </div>
  );
}

// ── Stat card (page-local — designer §A.4) ─────────────────────────────────

interface PdfExtractStatCardProps {
  kind: PdfExtractStatus;
  label: string;
  value: number;
  active: boolean;
  pulse?: boolean;
  onClick: () => void;
}

function PdfExtractStatCard({
  kind,
  label,
  value,
  active,
  pulse,
  onClick,
}: PdfExtractStatCardProps): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${label} ${value.toLocaleString()}건${active ? ', 필터 활성' : ''}`}
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

// ── Status badge (page-local — designer §A.7) ─────────────────────────────

const STATUS_BADGE_CLASS: Record<PdfExtractStatus, string> = {
  PENDING: 'bg-bg-subtle text-fg-muted border-border',
  EXTRACTING:
    'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900',
  DONE:
    'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900',
  FAILED:
    'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900',
  SKIPPED: 'bg-bg-subtle text-fg-subtle border-border',
};

function PdfExtractStatusBadge({
  status,
}: {
  status: PdfExtractStatus;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        STATUS_BADGE_CLASS[status],
      )}
      aria-label={`상태: ${STATUS_LABEL[status]}`}
    >
      {status === 'EXTRACTING' ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : null}
      {STATUS_LABEL[status]}
    </span>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────

interface PdfExtractTableRowProps {
  row: PdfExtractRow;
  onRetryClick: () => void;
  retryPending: boolean;
}

function PdfExtractTableRow({
  row,
  onRetryClick,
  retryPending,
}: PdfExtractTableRowProps): JSX.Element {
  // Per contract §4.2 — only FAILED + SKIPPED rows accept retry. The other
  // states either are already in flight (PENDING/EXTRACTING) or have no
  // failure to retry (DONE).
  const canRetry =
    row.pdfExtractStatus === 'FAILED' || row.pdfExtractStatus === 'SKIPPED';

  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-bg-subtle',
        row.pdfExtractStatus === 'EXTRACTING' &&
          'bg-sky-50/40 shadow-[inset_2px_0_0] shadow-sky-400 dark:bg-sky-950/20',
        row.pdfExtractStatus === 'FAILED' &&
          'bg-rose-50/40 shadow-[inset_2px_0_0] shadow-rose-500 dark:bg-rose-950/20',
        row.pdfExtractStatus === 'DONE' &&
          'shadow-[inset_2px_0_0] shadow-emerald-400/60',
        row.pdfExtractStatus === 'PENDING' &&
          'shadow-[inset_2px_0_0] shadow-slate-300',
      )}
    >
      <td className="px-3 py-2 align-middle">
        <PdfExtractStatusBadge status={row.pdfExtractStatus} />
      </td>
      <td className="px-3 py-2 align-middle">
        <a
          href={`/objects/${row.objectId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono-num text-[12px] text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`자료 상세 새 탭에서 열기 — ${row.objectNumber}`}
          aria-label={`자료 상세 새 탭에서 열기 — ${row.objectNumber}`}
        >
          {row.objectNumber}
        </a>
      </td>
      <td className="px-3 py-2 align-middle">
        <div
          className="max-w-[420px] truncate text-xs text-fg-muted"
          title={row.filename}
        >
          {row.filename}
        </div>
      </td>
      <td className="px-3 py-2 text-right align-middle font-mono-num text-[12px] text-fg-muted">
        {row.contentLength != null
          ? `${row.contentLength.toLocaleString()} 자`
          : '—'}
      </td>
      <td
        className="px-3 py-2 align-middle font-mono-num text-[12px] text-fg-muted"
        title={row.pdfExtractAt ?? undefined}
      >
        {formatTimestamp(row.pdfExtractAt)}
      </td>
      <td className="px-3 py-2 align-middle">
        {row.pdfExtractError ? (
          <span
            className="block max-w-[300px] truncate text-xs text-danger"
            title={row.pdfExtractError}
          >
            {row.pdfExtractError}
          </span>
        ) : (
          <span className="text-xs text-fg-subtle">—</span>
        )}
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className="inline-block max-w-[120px] truncate font-mono text-[11px] text-fg-muted"
          title={row.mimeType}
        >
          {row.mimeType}
        </span>
      </td>
      <td className="px-3 py-2 text-right align-middle">
        <Button
          size="sm"
          variant="outline"
          onClick={onRetryClick}
          disabled={!canRetry || retryPending}
          aria-disabled={!canRetry || undefined}
          aria-label={
            canRetry ? '재시도' : '재시도 불가 — 이 상태에서는 재시도할 수 없습니다'
          }
          title={
            canRetry ? undefined : '이 상태에서는 재시도할 수 없습니다'
          }
          className="h-7 px-2"
        >
          {retryPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          재시도
        </Button>
      </td>
    </tr>
  );
}
