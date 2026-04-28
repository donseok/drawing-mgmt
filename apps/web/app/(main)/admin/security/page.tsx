'use client';

/**
 * /admin/security — R40 SEC-PAGE + R41 보강 (B/C 카드).
 *
 * pnpm audit 결과를 admin에게 노출. 4개의 severity 카운트 카드 + 마지막 검사
 * 시각 + [지금 검사] 버튼. R41에서 추가:
 *   - 카운트 카드 클릭 → 하단 테이블 필터 토글 (`severityFilter` 단일 source)
 *   - 카드 active 시각: ring-2 ring-brand/40 + bg-bg-subtle + aria-pressed
 *   - VulnerabilitiesTable: 카운트 카드 아래에 advisory 배열 drill-down
 *   - allZero EmptyState는 R40 그대로 (테이블 mount 안 됨)
 *
 * 데이터 흐름:
 *   - GET  /api/v1/admin/security/audit  (useAdminSecurityAudit) — R41에서
 *     `advisories` 배열 포함 (계약 §4.3)
 *   - POST /api/v1/admin/security/audit  (useRunSecurityAudit) — invalidates
 *     the same cache key on settle so 카드와 테이블은 mutation이 끝나면 자동
 *     갱신.
 *
 * 권한: BE가 SUPER_ADMIN/ADMIN 외에는 403을 돌려주므로 별도 client gate를
 * 두지 않음. /admin/users 같은 다른 admin 페이지와 동일 패턴 (서버
 * /admin/page.tsx 진입을 통해 일반 사용자는 이미 redirect됐음).
 *
 * 디자이너 spec: docs/_specs/r40_mfa_login_security_pdf.md §C,
 *               docs/_specs/r41_admin_pdf_extracts_vuln_table.md §B/§C.
 */

import * as React from 'react';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { AdminSidebar } from '@/app/(main)/admin/AdminSidebar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { VulnerabilitiesTable } from '@/components/admin/VulnerabilitiesTable';
import { ApiError } from '@/lib/api-client';
import {
  useAdminSecurityAudit,
  useRunSecurityAudit,
  type AdminSecurityAuditResponse,
  type VulnerabilitySeverity,
} from '@/lib/queries';
import { cn } from '@/lib/cn';

interface VulnerabilityCounts {
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

export default function AdminSecurityPage(): JSX.Element {
  const auditQuery = useAdminSecurityAudit();
  const runMutation = useRunSecurityAudit();

  // Track a transient "방금 완료" affordance on the [지금 검사] button so the
  // user gets a confirmation flicker even when the count didn't change.
  const [justCompletedAt, setJustCompletedAt] = React.useState<number | null>(null);

  // R41 C — count card click → severity filter on the drill-down table. The
  // filter is a view-state concern only (no URL sync — designer §C.6); a
  // [지금 검사] mutation invalidates cache without resetting the filter so a
  // patch verification trip stays sticky.
  const [severityFilter, setSeverityFilter] =
    React.useState<VulnerabilitySeverity | null>(null);
  const toggleSeverity = React.useCallback((sev: VulnerabilitySeverity) => {
    setSeverityFilter((cur) => (cur === sev ? null : sev));
  }, []);
  const clearSeverity = React.useCallback(() => setSeverityFilter(null), []);

  const handleRunNow = React.useCallback(() => {
    runMutation.mutate(undefined, {
      onSuccess: (data) => {
        setJustCompletedAt(Date.now());
        const total = data.count;
        if (total === 0) {
          toast.success('취약점이 발견되지 않았습니다.');
        } else {
          toast.success(`검사 완료 — ${total.toLocaleString()}건 발견`);
        }
        // Reset the "방금 완료" badge after ~2s.
        window.setTimeout(() => setJustCompletedAt(null), 2_000);
      },
      onError: (err: ApiError) => {
        // 503 + AUDIT_RUN_FAILED is the documented "캐시 없음 + pnpm 실패"
        // state. Surface a slightly more helpful blurb so the admin knows
        // retrying is the next step.
        if (err.status === 503 && err.code === 'AUDIT_RUN_FAILED') {
          toast.error('검사 실행 실패', {
            description:
              '이전 캐시가 없어 결과를 표시할 수 없습니다. 잠시 후 다시 시도하세요.',
          });
          return;
        }
        toast.error('검사 실패', { description: err.message });
      },
    });
  }, [runMutation]);

  const data = auditQuery.data;
  const counts: VulnerabilityCounts = data?.vulnerabilities ?? {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
  };
  const totalCount =
    data?.count ?? counts.critical + counts.high + counts.moderate + counts.low;
  const allZero = data ? totalCount === 0 : false;

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />

      <section className="flex-1 overflow-auto bg-bg">
        <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
          <header>
            <div className="app-kicker">Administration · 통합/로그</div>
            <h1 className="mt-1 text-xl font-semibold text-fg">의존성 보안</h1>
            <p className="mt-1 text-sm text-fg-muted">
              pnpm audit 결과를 기반으로 npm 의존성의 알려진 취약점을 모니터링합니다.
            </p>
          </header>

          {auditQuery.isLoading ? (
            <LoadingPanels />
          ) : auditQuery.isError ? (
            <ErrorBanner
              error={auditQuery.error}
              onRetry={() => auditQuery.refetch()}
            />
          ) : (
            <>
              <SecurityAuditCard
                lastCheckedAt={data?.lastChecked ?? null}
                isRunning={runMutation.isPending}
                isError={runMutation.isError}
                lastErrorMessage={runMutation.error?.message ?? null}
                justCompleted={justCompletedAt !== null}
                onRunNow={handleRunNow}
              />
              <VulnerabilityCounts
                counts={counts}
                dimZeros={!allZero}
                activeSeverity={severityFilter}
                onToggle={toggleSeverity}
              />
              {allZero ? (
                <VulnerabilitiesEmpty />
              ) : (
                <VulnerabilitiesTable
                  advisories={data?.advisories ?? []}
                  filter={severityFilter}
                  onClearFilter={clearSeverity}
                />
              )}
            </>
          )}

          <p className="rounded-md border border-dashed border-border bg-bg-subtle px-3 py-2 text-xs text-fg-muted">
            pnpm audit는 매일 02:00 KST 자동 실행됩니다. CI에서도 high 이상 취약점이 발견되면
            워크플로 카드가 빨갛게 표시됩니다(머지 차단은 안 함).
          </p>
        </div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SecurityAuditCard — 마지막 검사 + [지금 검사] 4상태 버튼
// ──────────────────────────────────────────────────────────────────────────

interface SecurityAuditCardProps {
  lastCheckedAt: string | null;
  isRunning: boolean;
  isError: boolean;
  lastErrorMessage: string | null;
  justCompleted: boolean;
  onRunNow: () => void;
}

function SecurityAuditCard({
  lastCheckedAt,
  isRunning,
  isError,
  lastErrorMessage,
  justCompleted,
  onRunNow,
}: SecurityAuditCardProps): JSX.Element {
  const absolute = formatKstAbsolute(lastCheckedAt);
  const relative = formatKstRelative(lastCheckedAt);
  const isoTitle = lastCheckedAt ?? undefined;

  return (
    <div className="space-y-2">
      <div className="app-panel flex items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
            마지막 검사
          </p>
          {lastCheckedAt ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-2" title={isoTitle}>
              <span className="text-sm font-medium text-fg">{absolute}</span>
              <span className="text-xs text-fg-muted">({relative})</span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-fg-muted">아직 검사된 적이 없습니다.</p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onRunNow}
          disabled={isRunning}
          aria-disabled={isRunning || undefined}
          className="shrink-0"
        >
          {isRunning ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              검사 중... (최대 1분)
            </span>
          ) : justCompleted ? (
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              완료
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              지금 검사
            </span>
          )}
        </Button>
      </div>
      {isError && lastErrorMessage ? (
        <p className="text-xs text-danger" role="alert">
          검사 실패: {lastErrorMessage}
        </p>
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// VulnerabilityCounts — 4 카드 grid
// ──────────────────────────────────────────────────────────────────────────

interface VulnerabilityCountsProps {
  counts: VulnerabilityCounts;
  /** 0건 카드를 dim 처리. allZero일 때는 모든 카드를 동일 톤으로 표시. */
  dimZeros: boolean;
  /**
   * R41 C — currently active severity filter. When set, the matching card
   * renders the active token (`ring-2 ring-brand/40 + bg-bg-subtle`). Optional
   * so older callers (R40 shape) keep working.
   */
  activeSeverity?: VulnerabilitySeverity | null;
  /**
   * R41 C — click handler for card toggle. When provided, cards become
   * `<button aria-pressed>` elements; otherwise the legacy `<div>` static
   * cards are rendered.
   */
  onToggle?: (severity: VulnerabilitySeverity) => void;
}

function VulnerabilityCounts({
  counts,
  dimZeros,
  activeSeverity = null,
  onToggle,
}: VulnerabilityCountsProps): JSX.Element {
  const items: Array<{
    key: VulnerabilitySeverity;
    label: string;
    dotClass: string;
    ariaSeverity: string;
  }> = [
    // R39 §J #7 — Critical만 danger, High는 warning. Moderate는 warning의
    // 반투명 변형, Low는 neutral fg-muted. 색만으로 severity를 표현하지 않도록
    // 텍스트 라벨은 항상 함께 노출.
    {
      key: 'critical',
      label: 'Critical',
      dotClass: 'bg-danger',
      ariaSeverity: '심각',
    },
    {
      key: 'high',
      label: 'High',
      dotClass: 'bg-warning',
      ariaSeverity: '높음',
    },
    {
      key: 'moderate',
      label: 'Moderate',
      dotClass: 'bg-warning/60',
      ariaSeverity: '보통',
    },
    {
      key: 'low',
      label: 'Low',
      dotClass: 'bg-fg-muted',
      ariaSeverity: '낮음',
    },
  ];

  return (
    <dl className="grid grid-cols-4 gap-3">
      {items.map((it) => {
        const value = counts[it.key];
        const isZero = value === 0;
        const isActive = activeSeverity === it.key;
        const baseClass = cn(
          'app-panel p-4 transition-opacity',
          dimZeros && isZero ? 'opacity-60' : 'opacity-100',
        );

        const inner = (
          <>
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {it.label}
            </dt>
            <dd className="mt-1 flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className={cn('inline-block h-2 w-2 rounded-full', it.dotClass)}
              />
              <span className="text-3xl font-semibold tabular-nums text-fg">
                {value.toLocaleString()}
              </span>
            </dd>
          </>
        );

        if (!onToggle) {
          return (
            <div key={it.key} className={baseClass}>
              {inner}
            </div>
          );
        }

        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={isActive}
            aria-label={`${it.label} ${value.toLocaleString()}건${isActive ? ', 필터 활성' : ''}`}
            onClick={() => onToggle(it.key)}
            className={cn(
              baseClass,
              'text-left',
              'hover:border-border-strong hover:bg-bg-subtle',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive && 'bg-bg-subtle ring-2 ring-brand/40',
            )}
          >
            {inner}
          </button>
        );
      })}
    </dl>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// VulnerabilitiesEmpty — 4건 모두 0일 때 EmptyState
// ──────────────────────────────────────────────────────────────────────────

function VulnerabilitiesEmpty(): JSX.Element {
  return (
    <div
      role="status"
      className="rounded-lg border border-border bg-bg p-10 text-center"
    >
      <div className="mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
        <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
      </div>
      <p className="text-base font-medium text-fg">발견된 취약점이 없습니다.</p>
      <p className="mt-2 text-sm text-fg-muted">
        pnpm audit가 모든 패키지를 점검했고 현재 알려진 취약점은 없습니다.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Loading / Error
// ──────────────────────────────────────────────────────────────────────────

function LoadingPanels(): JSX.Element {
  return (
    <>
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </>
  );
}

interface ErrorBannerProps {
  error: ApiError | null | undefined;
  onRetry: () => void;
}

function ErrorBanner({ error, onRetry }: ErrorBannerProps): JSX.Element {
  // 503 AUDIT_RUN_FAILED — designer §H.2 친절한 메시지.
  const isAuditRunFailed =
    error?.status === 503 && error?.code === 'AUDIT_RUN_FAILED';
  const message = isAuditRunFailed
    ? '이전 캐시가 없어 결과를 표시할 수 없습니다. [지금 검사] 버튼을 다시 시도하세요.'
    : '검사 결과를 불러올 수 없습니다.';
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/25 bg-danger/10 p-4 text-sm text-danger"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 underline underline-offset-2 hover:no-underline"
      >
        재시도
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 시간 포맷터 — KST 절대 + 상대 (designer §C.4.1)
// ──────────────────────────────────────────────────────────────────────────

function formatKstAbsolute(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  // YYYY-MM-DD HH:mm — R28 패턴.
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatKstRelative(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 0) return '곧';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}일 전`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}달 전`;
  const yr = Math.floor(day / 365);
  return `${yr}년 전`;
}

// Re-export the response type alias so tests/integration helpers have a
// single import path. (Internally we already use it via `useAdminSecurityAudit`.)
export type { AdminSecurityAuditResponse };
