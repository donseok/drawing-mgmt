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
  Box,
  Cable,
  CheckCircle2,
  CircleDashed,
  ClipboardCopy,
  Cloud,
  Files,
  FolderOpen,
  HardDrive,
  Info,
  Loader2,
  RefreshCw,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { AdminSidebar } from '@/app/(main)/admin/AdminSidebar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import type {
  S3ConfigDTO,
  StorageConnectionState,
  StorageDriver,
  StorageInfoDTO,
  StorageTestResultDTO,
} from '@/components/storage/types';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

/**
 * /admin/storage — R34 V-INF-1.
 *
 * Inspector for the active storage driver (LOCAL / S3) plus a "연결 테스트"
 * button that performs a live put → stat → delete probe and surfaces the
 * round-trip latency. Stats cards show total objects, total bytes, and a 24h
 * recent-throughput counter.
 *
 * Endpoints — api_contract.md §6:
 *   GET  /api/v1/admin/storage/info     → StorageInfoDTO
 *   POST /api/v1/admin/storage/test     → StorageTestResultDTO
 *
 * Polling: 60 seconds (driver/config rarely change; stats are aggregate). The
 * test mutation invalidates the same key on settle so the connection badge
 * reflects the just-run probe immediately.
 *
 * Migration tooling (LOCAL ↔ S3 bulk copy) is intentionally deferred to a
 * later round; spec §6 leaves it as TODO. We surface a small advisory note
 * in the page footer so admins know it's coming.
 */

// ── Formatters ────────────────────────────────────────────────────────────

function formatBytes(input: number | string | null | undefined): string {
  if (input === null || input === undefined) return '—';
  const n = typeof input === 'string' ? Number(input) : input;
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${(n / 1024 ** 4).toFixed(2)} TB`;
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function StoragePage(): JSX.Element {
  const queryClient = useQueryClient();

  const infoQuery = useQuery<StorageInfoDTO, ApiError>({
    queryKey: queryKeys.admin.storageInfo(),
    queryFn: () => api.get<StorageInfoDTO>('/api/v1/admin/storage/info'),
    placeholderData: keepPreviousData, // v5 — see frontend.md §4
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Track the most recent test result so we can render a small inline summary
  // (latency + driver) next to the button. Server also reflects the new state
  // through `info.connection` once we invalidate.
  const [lastTest, setLastTest] = React.useState<StorageTestResultDTO | null>(
    null,
  );

  const testMutation = useMutation<StorageTestResultDTO, ApiError, void>({
    mutationFn: () => api.post<StorageTestResultDTO>('/api/v1/admin/storage/test'),
    onSuccess: (data) => {
      setLastTest(data);
      if (data.ok) {
        toast.success('스토리지 연결에 성공했습니다.', {
          description: `${data.driver} · ${data.latencyMs}ms`,
        });
      } else {
        toast.error('스토리지 연결 실패', {
          description: data.message ?? '응답이 비어 있습니다.',
        });
      }
      // Refresh connection badge / stats off the same probe.
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.storage() });
    },
    onError: (err) => {
      if (err.status === 403) {
        toast.error('스토리지 점검 권한이 없습니다.');
      } else if (err.code === 'E_RATE_LIMIT') {
        toast.error('요청 빈도 제한에 걸렸습니다. 잠시 후 다시 시도하세요.');
      } else {
        toast.error('연결 테스트 실패', { description: err.message });
      }
    },
  });

  const info = infoQuery.data ?? null;
  const isInitialLoad = infoQuery.isPending && !info;

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />

      <section className="flex min-w-0 flex-1 flex-col overflow-auto bg-bg">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
          <span className="text-fg-muted">관리자</span>
          <span className="text-fg-subtle">/</span>
          <span className="font-medium text-fg">스토리지</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <div className="app-kicker">Admin Console</div>
            <h1 className="mt-1 text-2xl font-semibold text-fg">스토리지</h1>
            <p className="mt-1 text-sm text-fg-muted">
              현재 활성 저장소 드라이버와 연결 상태를 확인합니다. 마이그레이션
              도구는 다음 라운드에 제공됩니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void infoQuery.refetch()}
              disabled={infoQuery.isFetching}
              aria-label="새로고침"
              title="새로고침"
            >
              <RefreshCw
                className={cn(
                  'h-4 w-4',
                  infoQuery.isFetching && 'animate-spin',
                )}
                aria-hidden="true"
              />
            </Button>
            <Button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !info}
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Cable className="h-4 w-4" aria-hidden="true" />
              )}
              연결 테스트
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
          {isInitialLoad ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            </div>
          ) : infoQuery.isError ? (
            <div className="flex flex-1 items-center justify-center p-10">
              <EmptyState
                icon={AlertCircle}
                title={
                  infoQuery.error?.status === 403
                    ? '스토리지 정보 조회 권한이 없습니다'
                    : '스토리지 정보를 불러오지 못했습니다'
                }
                description={infoQuery.error?.message}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void infoQuery.refetch()}
                  >
                    재시도
                  </Button>
                }
              />
            </div>
          ) : info ? (
            <div className="space-y-6">
              <DriverCard
                info={info}
                lastTest={lastTest}
                testPending={testMutation.isPending}
              />

              {info.driver === 'LOCAL' && info.local ? (
                <LocalConfigCard local={info.local} />
              ) : null}

              {info.driver === 'S3' && info.s3 ? (
                <S3ConfigCard s3={info.s3} />
              ) : null}

              <StatsGrid stats={info.stats} />

              <p className="text-[11px] text-fg-subtle">
                마지막 갱신:{' '}
                <span className="font-mono-num">
                  {formatTimestamp(info.capturedAt)}
                </span>
              </p>

              <div className="rounded-md border border-dashed border-border bg-bg-subtle p-4 text-xs text-fg-muted">
                <div className="mb-1 inline-flex items-center gap-1.5 font-medium text-fg">
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  마이그레이션 도구
                </div>
                LOCAL ↔ S3 일괄 이전 도구는 다음 라운드에서 제공됩니다. 그 전까지
                드라이버 전환은 운영 환경 변수(STORAGE_DRIVER) 변경 후 재배포로
                수행하세요.
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

// ── DriverCard ─────────────────────────────────────────────────────────────
// Top hero card: driver pill + connection state + last test summary.

interface DriverCardProps {
  info: StorageInfoDTO;
  lastTest: StorageTestResultDTO | null;
  testPending: boolean;
}

function DriverCard({ info, lastTest, testPending }: DriverCardProps): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-bg p-5">
      <div className="flex flex-wrap items-center gap-3">
        <DriverBadge driver={info.driver} />
        <ConnectionBadge state={info.connection} />
        {testPending ? (
          <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            테스트 중…
          </span>
        ) : null}
      </div>

      {info.connection === 'ERROR' && info.connectionMessage ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50/60 p-3 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          <div className="font-medium">최근 진단 메시지</div>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
            {info.connectionMessage}
          </pre>
        </div>
      ) : null}

      {lastTest ? (
        <div
          className={cn(
            'mt-3 rounded-md border p-3 text-xs',
            lastTest.ok
              ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50/60 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300',
          )}
        >
          <div className="flex items-center gap-1.5 font-medium">
            {lastTest.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {lastTest.ok ? '연결 정상' : '연결 실패'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-num">
            <span>지연 {lastTest.latencyMs}ms</span>
            <span>드라이버 {lastTest.driver}</span>
            <span>{formatTimestamp(lastTest.testedAt)}</span>
          </div>
          {!lastTest.ok && lastTest.message ? (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
              {lastTest.message}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── DriverBadge ────────────────────────────────────────────────────────────

interface DriverBadgeProps {
  driver: StorageDriver;
}

function DriverBadge({ driver }: DriverBadgeProps): JSX.Element {
  const v =
    driver === 'LOCAL'
      ? {
          label: 'LOCAL',
          subtitle: '로컬 파일시스템',
          Icon: HardDrive,
          pill: 'bg-slate-100 text-slate-800 dark:bg-slate-900/60 dark:text-slate-200',
        }
      : {
          label: 'S3',
          subtitle: 'S3 호환 객체저장소',
          Icon: Cloud,
          pill: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
        };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5',
        v.pill,
      )}
      aria-label={`드라이버: ${v.label}`}
    >
      <v.Icon className="h-4 w-4" aria-hidden="true" />
      <span className="text-sm font-semibold tracking-wide">{v.label}</span>
      <span className="text-xs font-normal text-fg-muted">{v.subtitle}</span>
    </span>
  );
}

// ── ConnectionBadge ────────────────────────────────────────────────────────

interface ConnectionBadgeProps {
  state: StorageConnectionState;
}

function ConnectionBadge({ state }: ConnectionBadgeProps): JSX.Element {
  const v: { label: string; pill: string; dot: string; pulse: boolean; Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }> } =
    state === 'OK'
      ? {
          label: '연결됨',
          pill: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
          dot: 'bg-emerald-500',
          pulse: false,
          Icon: CheckCircle2,
        }
      : state === 'ERROR'
        ? {
            label: '연결 실패',
            pill: 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
            dot: 'bg-rose-500',
            pulse: true,
            Icon: XCircle,
          }
        : {
            label: '미확인',
            pill: 'bg-slate-100 text-slate-700 dark:bg-slate-900/60 dark:text-slate-300',
            dot: 'bg-slate-400',
            pulse: false,
            Icon: CircleDashed,
          };

  return (
    <span
      role="status"
      aria-label={`연결 상태: ${v.label}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        v.pill,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          v.dot,
          v.pulse && 'animate-pulse',
        )}
      />
      <v.Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{v.label}</span>
    </span>
  );
}

// ── LocalConfigCard ────────────────────────────────────────────────────────

function LocalConfigCard({
  local,
}: {
  local: NonNullable<StorageInfoDTO['local']>;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-bg p-5">
      <h2 className="mb-3 text-sm font-semibold text-fg">로컬 저장소 설정</h2>
      <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <ConfigRow
          icon={FolderOpen}
          label="저장 루트"
          value={
            <span className="break-all font-mono text-[12px] text-fg">
              {local.root}
            </span>
          }
          copyable={local.root}
        />
        <ConfigRow
          icon={HardDrive}
          label="여유 공간"
          value={
            <span className="font-mono-num text-[12px] text-fg">
              {formatBytes(local.freeBytes)}
            </span>
          }
        />
      </dl>
    </div>
  );
}

// ── S3ConfigCard ───────────────────────────────────────────────────────────

function S3ConfigCard({ s3 }: { s3: S3ConfigDTO }): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-bg p-5">
      <h2 className="mb-3 text-sm font-semibold text-fg">S3 저장소 설정</h2>
      <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <ConfigRow
          icon={Cloud}
          label="엔드포인트"
          value={
            s3.endpoint ? (
              <span className="break-all font-mono text-[12px] text-fg">
                {s3.endpoint}
              </span>
            ) : (
              <span className="text-fg-muted">기본 (AWS)</span>
            )
          }
          copyable={s3.endpoint ?? undefined}
        />
        <ConfigRow
          icon={Box}
          label="버킷"
          value={
            <span className="break-all font-mono text-[12px] text-fg">
              {s3.bucket}
            </span>
          }
          copyable={s3.bucket}
        />
        <ConfigRow
          icon={Info}
          label="리전"
          value={
            s3.region ? (
              <span className="font-mono text-[12px] text-fg">{s3.region}</span>
            ) : (
              <span className="text-fg-muted">—</span>
            )
          }
        />
        <ConfigRow
          icon={Info}
          label="Path-style"
          value={
            <span className="text-[12px] text-fg">
              {s3.forcePathStyle ? '강제' : '자동'}
            </span>
          }
        />
        <ConfigRow
          icon={Info}
          label="Access Key"
          value={
            <span className="font-mono text-[12px] text-fg">
              {s3.accessKeyMasked ?? '—'}
            </span>
          }
        />
        <ConfigRow
          icon={Info}
          label="Secret Key"
          value={
            s3.hasSecretKey ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                설정됨
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[12px] text-rose-700 dark:text-rose-400">
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                미설정
              </span>
            )
          }
        />
      </dl>
    </div>
  );
}

// ── ConfigRow ──────────────────────────────────────────────────────────────

interface ConfigRowProps {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  label: string;
  value: React.ReactNode;
  /** When provided, renders a small copy button next to the value. */
  copyable?: string;
}

function ConfigRow({ icon: Icon, label, value, copyable }: ConfigRowProps): JSX.Element {
  const handleCopy = React.useCallback(async () => {
    if (!copyable) return;
    try {
      await navigator.clipboard.writeText(copyable);
      toast.success('클립보드에 복사되었습니다.');
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  }, [copyable]);

  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-bg-subtle px-3 py-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <dt className="text-[11px] font-medium uppercase text-fg-subtle">
          {label}
        </dt>
        <dd className="min-w-0">{value}</dd>
      </div>
      {copyable ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={() => void handleCopy()}
          aria-label={`${label} 복사`}
          title="복사"
        >
          <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

// ── StatsGrid ──────────────────────────────────────────────────────────────

function StatsGrid({
  stats,
}: {
  stats: StorageInfoDTO['stats'];
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <StatCard
        icon={Files}
        label="총 객체 수"
        value={formatNumber(stats.totalObjects)}
        hint="첨부 + 미리보기 합계"
      />
      <StatCard
        icon={HardDrive}
        label="총 사용량"
        value={formatBytes(stats.totalBytes)}
        hint="저장된 모든 객체 합계"
      />
      <StatCard
        icon={TrendingUp}
        label="최근 24시간"
        value={formatNumber(stats.recentObjects)}
        hint="새로 추가된 객체 수"
      />
    </div>
  );
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  label: string;
  value: string;
  hint?: string;
}

function StatCard({ icon: Icon, label, value, hint }: StatCardProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-bg p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
        <span className="text-xs font-medium uppercase text-fg-subtle">
          {label}
        </span>
      </div>
      <span className="text-2xl font-semibold tabular-nums text-fg">{value}</span>
      {hint ? <span className="text-xs text-fg-muted">{hint}</span> : null}
    </div>
  );
}
