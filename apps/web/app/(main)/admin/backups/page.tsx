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
  Archive,
  ClipboardCopy,
  Download,
  Info,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
} from 'lucide-react';
import { toast } from 'sonner';

import { AdminSidebar } from '@/app/(main)/admin/AdminSidebar';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { BackupStatusBadge } from '@/components/backup/BackupStatusBadge';
import { BackupKindBadge } from '@/components/backup/BackupKindBadge';
import { BackupRunDialog } from '@/components/backup/BackupRunDialog';
import type {
  BackupKind,
  BackupListEnvelope,
  BackupRowDTO,
  BackupRunResponse,
} from '@/components/backup/types';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

/**
 * /admin/backups — DESIGN spec r33 §B (deferred until designer doc lands;
 * structure follows existing /admin/conversions surface so the look stays
 * consistent across the admin console).
 *
 * Endpoint contract — api_contract.md §4.3:
 *   GET  /api/v1/admin/backups?kind=&cursor=&limit=
 *   POST /api/v1/admin/backups/run         body: { kind: 'POSTGRES'|'FILES' }
 *   GET  /api/v1/admin/backups/:id/download
 *
 * Behaviors:
 *   - 5-second polling, gated on at least one row in RUNNING (else stops).
 *   - Filter by kind via shadcn Select.
 *   - "지금 실행" opens BackupRunDialog → POSTs /run → toast → invalidate.
 *   - Per-row download button, enabled only for DONE rows. We hop to the
 *     `/download` endpoint via a hidden <a download> click so the browser
 *     can stream the file directly.
 */

// Raw fetch (we want the meta envelope; api.get unwraps `data`).
async function fetchBackups(params: {
  kind?: BackupKind;
  cursor?: string;
  limit?: number;
}): Promise<BackupListEnvelope> {
  const url = new URL('/api/v1/admin/backups', window.location.origin);
  if (params.kind) url.searchParams.set('kind', params.kind);
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
  return parsed as BackupListEnvelope;
}

// ── Formatters ─────────────────────────────────────────────────────────────

function formatBytes(input: number | string | null): string {
  if (input === null || input === undefined) return '—';
  const n = typeof input === 'string' ? Number(input) : input;
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

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
  if (min < 60) return sec === 0 ? `${min}m` : `${min}m${sec}s`;
  const hour = Math.floor(min / 60);
  const restMin = min % 60;
  return restMin === 0 ? `${hour}h` : `${hour}h${restMin}m`;
}

function deriveDuration(row: BackupRowDTO): number | null {
  if (row.durationMs !== null && row.durationMs !== undefined) return row.durationMs;
  if (!row.finishedAt) return null;
  const a = new Date(row.startedAt).getTime();
  const b = new Date(row.finishedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return b - a;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function BackupsPage(): JSX.Element {
  const queryClient = useQueryClient();

  const [kindFilter, setKindFilter] = React.useState<'ALL' | BackupKind>('ALL');
  const [pages, setPages] = React.useState<BackupRowDTO[][]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);

  // When the kind filter changes, drop accumulated load-more pages — they
  // belong to the previous filter and would mix in stale rows.
  React.useEffect(() => {
    setPages([]);
    setNextCursor(null);
  }, [kindFilter]);

  // Page-0 list query. Polls only while at least one row is RUNNING.
  const listQuery = useQuery<BackupListEnvelope, ApiError>({
    queryKey: queryKeys.admin.backups({
      kind: kindFilter === 'ALL' ? undefined : kindFilter,
    }),
    queryFn: () =>
      fetchBackups({
        kind: kindFilter === 'ALL' ? undefined : kindFilter,
        limit: 50,
      }),
    placeholderData: keepPreviousData, // v5 (frontend.md §4)
    refetchInterval: (query) => {
      const rows = query.state.data?.data ?? [];
      const hasRunning =
        (query.state.data?.meta.runningCount ?? 0) > 0 ||
        rows.some((r) => r.status === 'RUNNING');
      return hasRunning ? 5000 : false;
    },
    refetchIntervalInBackground: false,
  });

  // Track nextCursor when page-0 lands.
  React.useEffect(() => {
    if (listQuery.data) {
      setNextCursor(listQuery.data.meta.nextCursor);
    }
  }, [listQuery.data]);

  const loadMore = React.useCallback(async () => {
    if (!nextCursor) return;
    try {
      const env = await fetchBackups({
        kind: kindFilter === 'ALL' ? undefined : kindFilter,
        cursor: nextCursor,
        limit: 50,
      });
      setPages((prev) => [...prev, env.data]);
      setNextCursor(env.meta.nextCursor);
    } catch (err) {
      const e = err as ApiError;
      toast.error('추가 로딩 실패', { description: e.message });
    }
  }, [nextCursor, kindFilter]);

  const allRows = React.useMemo(() => {
    const page0 = listQuery.data?.data ?? [];
    return [...page0, ...pages.flat()];
  }, [listQuery.data, pages]);

  // Per-kind RUNNING set so the BackupRunDialog can disable a kind that is
  // already in flight (BE serializes at concurrency=1 and would 409 anyway).
  const runningKinds = React.useMemo<ReadonlySet<BackupKind>>(() => {
    const set = new Set<BackupKind>();
    for (const r of allRows) {
      if (r.status === 'RUNNING') set.add(r.kind);
      if (set.size === 2) break;
    }
    return set;
  }, [allRows]);

  // ── Run mutation ────────────────────────────────────────────────────────
  const runMutation = useMutation<BackupRunResponse, ApiError, { kind: BackupKind }>({
    mutationFn: ({ kind }) =>
      api.post<BackupRunResponse>('/api/v1/admin/backups/run', { kind }),
    onSuccess: (data) => {
      const label = data.kind === 'POSTGRES' ? 'Postgres' : '파일 저장소';
      toast.success(`${label} 백업이 큐에 추가되었습니다.`);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
    onError: (err) => {
      if (err.status === 403) {
        toast.error('백업 실행 권한이 없습니다.');
      } else if (err.status === 409) {
        toast.warning('이미 실행 중인 백업이 있습니다.', { description: err.message });
      } else if (err.code === 'E_RATE_LIMIT') {
        toast.error('요청 빈도 제한에 걸렸습니다. 잠시 후 다시 시도하세요.');
      } else {
        toast.error('백업 실행 실패', { description: err.message });
      }
    },
  });

  const [runDialogOpen, setRunDialogOpen] = React.useState(false);

  const handleConfirmRun = React.useCallback(
    async (kind: BackupKind) => {
      try {
        await runMutation.mutateAsync({ kind });
        setRunDialogOpen(false);
      } catch {
        // mutation onError already surfaces a toast — keep dialog open so the
        // admin can retry without re-picking the kind.
      }
    },
    [runMutation],
  );

  // ── Download (hidden anchor click) ──────────────────────────────────────
  const handleDownload = React.useCallback((row: BackupRowDTO) => {
    if (row.status !== 'DONE') return;
    const url = `/api/v1/admin/backups/${row.id}/download`;
    const a = document.createElement('a');
    a.href = url;
    // Suggest a filename; the BE may also send Content-Disposition which
    // overrides this. Either way the browser streams the file directly.
    const ts = new Date(row.startedAt).toISOString().replace(/[:.]/g, '-');
    const ext = row.kind === 'POSTGRES' ? 'sql.gz' : 'tar.gz';
    a.download = `${row.kind.toLowerCase()}-${ts}.${ext}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />

      <section className="flex min-w-0 flex-1 flex-col overflow-auto bg-bg">
        {/* Breadcrumb + title */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
          <span className="text-fg-muted">관리자</span>
          <span className="text-fg-subtle">/</span>
          <span className="font-medium text-fg">백업</span>
        </div>

        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <div className="app-kicker">Admin Console</div>
            <h1 className="mt-1 text-2xl font-semibold text-fg">백업</h1>
            <p className="mt-1 text-sm text-fg-muted">
              매일 02:00에 자동 실행됩니다. 30일 후 자동 삭제됩니다.
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
            <Button
              onClick={() => setRunDialogOpen(true)}
              disabled={runMutation.isPending}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              지금 실행
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase text-fg-subtle">종류</span>
            <Select
              value={kindFilter}
              onValueChange={(v) => setKindFilter(v as 'ALL' | BackupKind)}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체</SelectItem>
                <SelectItem value="POSTGRES">Postgres</SelectItem>
                <SelectItem value="FILES">파일 저장소</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {listQuery.isFetching ? (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-fg-muted">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              새로고침 중…
            </span>
          ) : null}
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {listQuery.isPending ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : listQuery.isError ? (
            <div className="flex flex-1 items-center justify-center p-10">
              <EmptyState
                icon={AlertCircle}
                title={
                  listQuery.error?.status === 403
                    ? '백업 이력 조회 권한이 없습니다'
                    : '백업 이력을 불러오지 못했습니다'
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
                icon={Archive}
                title="백업 이력이 없습니다"
                description='매일 02:00에 자동 실행됩니다. 또는 우측 상단 "지금 실행"을 눌러 수동으로 실행할 수 있습니다. 백업은 30일 후 자동 삭제됩니다.'
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-bg-subtle shadow-[inset_0_-1px_0] shadow-border">
                  <tr>
                    <th className="w-[110px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      종류
                    </th>
                    <th className="w-[120px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      상태
                    </th>
                    <th className="w-[140px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      시작
                    </th>
                    <th className="w-[140px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      완료
                    </th>
                    <th className="w-[100px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      소요
                    </th>
                    <th className="w-[110px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      크기
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted">
                      에러
                    </th>
                    <th className="w-[120px] px-3 py-2 text-right text-[11px] font-semibold uppercase text-fg-muted">
                      다운로드
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allRows.map((row) => (
                    <BackupRow
                      key={row.id}
                      row={row}
                      onDownload={() => handleDownload(row)}
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

      <BackupRunDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        onConfirm={handleConfirmRun}
        pending={runMutation.isPending}
        runningKinds={runningKinds}
      />
    </div>
  );
}

// ── ErrorPopover ──────────────────────────────────────────────────────────
// FAILED row's errorMessage cell. Designer spec §B.9: clicking the trigger
// opens a popover with the full message + a copy button. Long messages
// (>2000 chars) are truncated head+tail with `(중략)` so the popover doesn't
// blow out the layout.

function truncateError(msg: string): string {
  if (msg.length <= 2000) return msg;
  return `${msg.slice(0, 1500)}\n…(중략)…\n${msg.slice(-500)}`;
}

interface ErrorPopoverProps {
  message: string;
}

function ErrorPopover({ message }: ErrorPopoverProps): JSX.Element {
  const display = React.useMemo(() => truncateError(message), [message]);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success('클립보드에 복사되었습니다.');
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  }, [message]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-sm text-left text-xs text-rose-700 hover:underline dark:text-rose-400',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label="오류 메시지 자세히 보기"
        >
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="max-w-[280px] truncate">오류 확인</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="max-w-sm space-y-2 p-3"
        align="start"
        side="bottom"
      >
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-rose-200 bg-rose-50/60 p-2 text-[11px] font-mono leading-relaxed text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          {display}
        </pre>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => void handleCopy()}>
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
            복사
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────

interface BackupRowProps {
  row: BackupRowDTO;
  onDownload: () => void;
}

function BackupRow({ row, onDownload }: BackupRowProps): JSX.Element {
  const duration = deriveDuration(row);
  const canDownload = row.status === 'DONE';

  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-bg-subtle',
        row.status === 'RUNNING' &&
          'bg-sky-50/40 shadow-[inset_2px_0_0] shadow-sky-400 dark:bg-sky-950/20',
        row.status === 'FAILED' &&
          'bg-rose-50/40 shadow-[inset_2px_0_0] shadow-rose-400 dark:bg-rose-950/20',
        row.status === 'DONE' && 'shadow-[inset_2px_0_0] shadow-emerald-400/60',
      )}
    >
      <td className="px-3 py-2 align-middle">
        <BackupKindBadge kind={row.kind} />
      </td>
      <td className="px-3 py-2 align-middle">
        <BackupStatusBadge status={row.status} />
      </td>
      <td className="px-3 py-2 align-middle font-mono-num text-[12px] text-fg-muted">
        {formatTimestamp(row.startedAt)}
      </td>
      <td className="px-3 py-2 align-middle font-mono-num text-[12px] text-fg-muted">
        {formatTimestamp(row.finishedAt)}
      </td>
      <td className="px-3 py-2 align-middle font-mono-num text-[12px] text-fg-muted">
        {formatDurationMs(duration)}
      </td>
      <td className="px-3 py-2 align-middle font-mono-num text-[12px] text-fg-muted">
        {formatBytes(row.sizeBytes)}
      </td>
      <td className="px-3 py-2 align-middle">
        {row.errorMessage ? (
          <ErrorPopover message={row.errorMessage} />
        ) : (
          <span className="text-xs text-fg-subtle">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right align-middle">
        <Button
          size="sm"
          variant="outline"
          onClick={onDownload}
          disabled={!canDownload}
          aria-label={canDownload ? '백업 파일 다운로드' : '다운로드 불가 (완료 전)'}
          className="h-7 px-2"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          다운로드
        </Button>
      </td>
    </tr>
  );
}
