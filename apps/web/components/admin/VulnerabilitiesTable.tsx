'use client';

/**
 * VulnerabilitiesTable — R41 B 카드.
 *
 * /admin/security 카운트 카드 4개 아래에서 advisory 배열을 drill-down 테이블로
 * 표시한다. designer §B (`docs/_specs/r41_admin_pdf_extracts_vuln_table.md`).
 *
 * 책임:
 *   - severity 우선(critical→low) → 같은 severity 내 package alpha 정렬
 *   - severityFilter prop 적용 (null이면 전체)
 *   - 50건 임계값(`VISIBLE_THRESHOLD`) 넘으면 [더 보기]로 batch reveal
 *   - 외부 advisory 링크 새 탭(rel=noopener noreferrer)
 *
 * 시각 토큰: 모두 R37 audit 통과 조합. critical=rose / high=amber /
 * moderate=sky / low=neutral. R40 dot 매핑(`bg-warning/60`)과 moderate가
 * 다른 이유는 designer §B.6에 기재 (badge는 톤 명확성을 위해 sky 채택).
 */

import * as React from 'react';
import { ExternalLink, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type {
  SecurityAdvisory,
  VulnerabilitySeverity,
} from '@/lib/queries';

const SEVERITY_ORDER: Record<VulnerabilitySeverity, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
};

// Visual label is English (matches pnpm audit + screenshots / docs); SR
// announces the Korean equivalent via aria-label (designer §F.3).
const SEVERITY_LABEL: Record<VulnerabilitySeverity, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
};

const SEVERITY_ARIA: Record<VulnerabilitySeverity, string> = {
  critical: '심각',
  high: '높음',
  moderate: '보통',
  low: '낮음',
};

const SEVERITY_BADGE_CLASS: Record<VulnerabilitySeverity, string> = {
  critical:
    'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900',
  high:
    'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900',
  moderate:
    'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900',
  low: 'bg-bg-subtle text-fg-muted border-border',
};

const SEVERITY_ROW_STRIPE: Record<VulnerabilitySeverity, string> = {
  critical: 'shadow-[inset_2px_0_0] shadow-rose-500',
  high: 'shadow-[inset_2px_0_0] shadow-amber-500',
  moderate: 'shadow-[inset_2px_0_0] shadow-sky-400/60',
  low: '',
};

/**
 * Reveal threshold (designer §I.3). pnpm audit advisory typically ≤ 30, so
 * a 50-row first-paint covers the vast majority. Past 50 the user clicks
 * [더 보기] to expand to the full set.
 */
const VISIBLE_THRESHOLD = 50;

export interface VulnerabilitiesTableProps {
  advisories: SecurityAdvisory[];
  /** Active severity filter; null = no filter. */
  filter: VulnerabilitySeverity | null;
  /** Called when the user clears the filter (chip [X] or in-table empty). */
  onClearFilter: () => void;
}

export function VulnerabilitiesTable({
  advisories,
  filter,
  onClearFilter,
}: VulnerabilitiesTableProps): JSX.Element {
  // Reset reveal state whenever filter changes — the user is now looking at a
  // smaller pool and shouldn't have to scroll past stale "show more" affordance.
  const [revealAll, setRevealAll] = React.useState(false);
  React.useEffect(() => {
    setRevealAll(false);
  }, [filter]);

  const sorted = React.useMemo(() => {
    const pool = filter
      ? advisories.filter((a) => a.severity === filter)
      : advisories;
    // Stable sort: severity primary, package name alpha secondary.
    return [...pool].sort((a, b) => {
      const d = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (d !== 0) return d;
      return a.package.localeCompare(b.package);
    });
  }, [advisories, filter]);

  const visible = revealAll ? sorted : sorted.slice(0, VISIBLE_THRESHOLD);
  const remaining = sorted.length - visible.length;

  return (
    <div className="space-y-2">
      {filter ? (
        <div className="flex items-center gap-2 px-1 text-xs">
          <span className="text-fg-muted">필터:</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-fg">
            {SEVERITY_LABEL[filter]}
            <button
              type="button"
              onClick={onClearFilter}
              aria-label="필터 해제"
              className="rounded-full p-0.5 hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-border bg-bg">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-bg-subtle shadow-[inset_0_-1px_0] shadow-border">
              <tr>
                <th
                  scope="col"
                  className="w-[100px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted"
                >
                  심각도
                </th>
                <th
                  scope="col"
                  className="w-[180px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted"
                >
                  패키지
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted"
                >
                  제목
                </th>
                <th
                  scope="col"
                  className="w-[160px] px-3 py-2 text-left text-[11px] font-semibold uppercase text-fg-muted"
                >
                  영향 범위
                </th>
                <th
                  scope="col"
                  className="w-[48px] px-1 py-2"
                  aria-label="외부 링크"
                />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-sm text-fg-muted"
                  >
                    {filter ? (
                      <>
                        {SEVERITY_LABEL[filter]} 심각도의 취약점이 없습니다.
                        <button
                          type="button"
                          onClick={onClearFilter}
                          className="ml-2 text-brand underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          필터 해제
                        </button>
                      </>
                    ) : (
                      <>표시할 취약점이 없습니다.</>
                    )}
                  </td>
                </tr>
              ) : (
                visible.map((a) => <VulnerabilityRow key={`${a.id}-${a.package}`} advisory={a} />)
              )}
            </tbody>
          </table>
        </div>

        {remaining > 0 ? (
          <div className="flex items-center justify-center border-t border-border bg-bg-subtle py-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRevealAll(true)}
            >
              더 보기 ({remaining.toLocaleString()})
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface VulnerabilityRowProps {
  advisory: SecurityAdvisory;
}

function VulnerabilityRow({ advisory: a }: VulnerabilityRowProps): JSX.Element {
  return (
    <tr
      className={cn(
        'border-t border-border transition-colors hover:bg-bg-subtle',
        SEVERITY_ROW_STRIPE[a.severity],
      )}
    >
      <td className="px-3 py-2 align-middle">
        <SeverityBadge severity={a.severity} />
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className="font-mono text-[12px] text-fg"
          title={a.package}
        >
          {a.package}
        </span>
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className="block max-w-[420px] truncate text-sm text-fg"
          title={a.title}
        >
          {a.title}
        </span>
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className="block max-w-[160px] truncate font-mono text-[11px] text-fg-muted"
          title={a.versionRange ?? undefined}
        >
          {a.versionRange ?? '—'}
        </span>
      </td>
      <td className="px-1 py-2 text-center align-middle">
        {a.url ? (
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${a.package} ${SEVERITY_ARIA[a.severity]} 취약점 외부 게시판 (새 탭)`}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={a.url}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : (
          <span
            className="inline-flex h-7 w-7 items-center justify-center text-fg-subtle/40"
            aria-label="외부 링크 없음"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
      </td>
    </tr>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: VulnerabilitySeverity;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        SEVERITY_BADGE_CLASS[severity],
      )}
      aria-label={`심각도: ${SEVERITY_ARIA[severity]}`}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
