'use client';

/**
 * VulnerabilitiesTable — R41 B 카드 + R54 polish (정렬 클릭 + CSV 내보내기).
 *
 * /admin/security 카운트 카드 4개 아래에서 advisory 배열을 drill-down 테이블로
 * 표시한다. designer §B (`docs/_specs/r41_admin_pdf_extracts_vuln_table.md`).
 *
 * 책임:
 *   - 기본 정렬: severity 우선(critical→low) → 같은 severity 내 package alpha
 *     (R41 그대로). aria-sort=none 상태로 시작.
 *   - 헤더 클릭으로 sort override (R54): severity / package / title.
 *     첫 클릭 → ascending, 같은 컬럼 재클릭 → descending. 다른 컬럼 클릭 시 다시
 *     ascending. 영향 범위 / 외부 링크는 정렬 의미 없으므로 그대로 둠.
 *   - severityFilter prop 적용 (null이면 전체)
 *   - 50건 임계값(`VISIBLE_THRESHOLD`) 넘으면 [더 보기]로 batch reveal
 *   - 외부 advisory 링크 새 탭(rel=noopener noreferrer)
 *   - CSV 내보내기 (R54): 현재 활성 필터 + 정렬 순서를 그대로 반영해 BOM 포함
 *     UTF-8 CSV로 다운로드. RFC 4180 cell 이스케이프.
 *
 * 시각 토큰: 모두 R37 audit 통과 조합. critical=rose / high=amber /
 * moderate=sky / low=neutral. R40 dot 매핑(`bg-warning/60`)과 moderate가
 * 다른 이유는 designer §B.6에 기재 (badge는 톤 명확성을 위해 sky 채택).
 */

import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, ExternalLink, X } from 'lucide-react';

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

// R54 — sortable columns. `null` = R41 default compound sort
// (severity desc → package asc). Anything else is an explicit user override.
type SortColumn = 'severity' | 'package' | 'title';
type SortDirection = 'asc' | 'desc';
interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

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

  // R54 — sort override. `null` keeps R41's compound default.
  const [sort, setSort] = React.useState<SortState | null>(null);

  const handleSortClick = React.useCallback((column: SortColumn) => {
    setSort((cur) => {
      if (!cur || cur.column !== column) {
        // First click on this column: ascending.
        return { column, direction: 'asc' };
      }
      // Re-click same column: toggle direction.
      return {
        column,
        direction: cur.direction === 'asc' ? 'desc' : 'asc',
      };
    });
  }, []);

  const sorted = React.useMemo(
    () => sortAdvisories(advisories, filter, sort),
    [advisories, filter, sort],
  );

  const visible = revealAll ? sorted : sorted.slice(0, VISIBLE_THRESHOLD);
  const remaining = sorted.length - visible.length;

  const handleExportCsv = React.useCallback(() => {
    // CSV reflects the *currently visible/active* sorted+filtered list, not
    // just the first VISIBLE_THRESHOLD rows. The reveal threshold is a UI
    // affordance, not a data filter.
    downloadCsv(sorted);
  }, [sorted]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 px-1">
        {filter ? (
          <div className="flex items-center gap-2 text-xs">
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
        <div className="ml-auto">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleExportCsv}
            disabled={sorted.length === 0}
            aria-label={
              filter
                ? `${SEVERITY_LABEL[filter]} 심각도 취약점 ${sorted.length.toLocaleString()}건을 CSV 파일로 내보내기`
                : `취약점 ${sorted.length.toLocaleString()}건을 CSV 파일로 내보내기`
            }
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            CSV 내보내기
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-bg">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-bg-subtle shadow-[inset_0_-1px_0] shadow-border">
              <tr>
                <SortableHeader
                  column="severity"
                  label="심각도"
                  sort={sort}
                  onSort={handleSortClick}
                  className="w-[100px]"
                />
                <SortableHeader
                  column="package"
                  label="패키지"
                  sort={sort}
                  onSort={handleSortClick}
                  className="w-[180px]"
                />
                <SortableHeader
                  column="title"
                  label="제목"
                  sort={sort}
                  onSort={handleSortClick}
                />
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

// ──────────────────────────────────────────────────────────────────────────
// SortableHeader — keyboard-accessible <th> with aria-sort
// ──────────────────────────────────────────────────────────────────────────

interface SortableHeaderProps {
  column: SortColumn;
  label: string;
  sort: SortState | null;
  onSort: (column: SortColumn) => void;
  className?: string;
}

function SortableHeader({
  column,
  label,
  sort,
  onSort,
  className,
}: SortableHeaderProps): JSX.Element {
  const isActive = sort?.column === column;
  // R54 spec: when no explicit sort is set, all sortable columns report
  // aria-sort="none" (the R41 default compound sort is implicit). Once the
  // user picks a column, that column reports asc/desc.
  const ariaSort: 'ascending' | 'descending' | 'none' = isActive
    ? sort!.direction === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none';

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        'px-0 py-0 text-left text-[11px] font-semibold uppercase text-fg-muted',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-label={
          isActive
            ? `${label}, ${ariaSort === 'ascending' ? '오름차순' : '내림차순'} 정렬됨. 다시 누르면 ${ariaSort === 'ascending' ? '내림차순' : '오름차순'}으로 정렬.`
            : `${label}, 정렬되지 않음. 누르면 오름차순으로 정렬.`
        }
        className={cn(
          'inline-flex w-full items-center justify-start gap-1 px-3 py-2 text-left',
          'transition-colors hover:bg-bg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          isActive && 'text-fg',
        )}
      >
        <span>{label}</span>
        <SortIcon active={isActive} direction={sort?.direction ?? null} />
      </button>
    </th>
  );
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection | null;
}): JSX.Element {
  if (!active) {
    return (
      <ArrowUpDown
        className="h-3 w-3 text-fg-subtle/60"
        aria-hidden="true"
      />
    );
  }
  return direction === 'asc' ? (
    <ArrowUp className="h-3 w-3 text-fg" aria-hidden="true" />
  ) : (
    <ArrowDown className="h-3 w-3 text-fg" aria-hidden="true" />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sorting — pure helper
// ──────────────────────────────────────────────────────────────────────────

function sortAdvisories(
  advisories: SecurityAdvisory[],
  filter: VulnerabilitySeverity | null,
  sort: SortState | null,
): SecurityAdvisory[] {
  const pool = filter
    ? advisories.filter((a) => a.severity === filter)
    : advisories;
  const arr = [...pool];

  if (!sort) {
    // R41 compound default: severity desc (critical→low) + package asc.
    arr.sort((a, b) => {
      const d = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (d !== 0) return d;
      return a.package.localeCompare(b.package);
    });
    return arr;
  }

  const dir = sort.direction === 'asc' ? 1 : -1;
  if (sort.column === 'severity') {
    // Severity asc = critical→low (mirrors the default ordinal). desc = low→critical.
    arr.sort((a, b) => {
      const d = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (d !== 0) return d * dir;
      // Stable secondary tiebreaker: package alpha asc regardless of dir.
      return a.package.localeCompare(b.package);
    });
    return arr;
  }
  if (sort.column === 'package') {
    arr.sort((a, b) => {
      const d = a.package.localeCompare(b.package);
      if (d !== 0) return d * dir;
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    });
    return arr;
  }
  // title
  arr.sort((a, b) => {
    const d = a.title.localeCompare(b.title);
    if (d !== 0) return d * dir;
    return a.package.localeCompare(b.package);
  });
  return arr;
}

// ──────────────────────────────────────────────────────────────────────────
// CSV export — RFC 4180 escape + UTF-8 BOM
// ──────────────────────────────────────────────────────────────────────────

const CSV_HEADERS = ['severity', 'package', 'title', 'version_range', 'url'] as const;

function csvEscape(value: string | null | undefined): string {
  // RFC 4180: wrap in double quotes if the cell contains comma, quote, CR, or LF.
  // Internal double quotes are escaped by doubling them.
  if (value == null) return '';
  const needsQuoting = /[",\r\n]/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function buildCsv(rows: SecurityAdvisory[]): string {
  const lines: string[] = [];
  lines.push(CSV_HEADERS.join(','));
  for (const a of rows) {
    lines.push(
      [
        csvEscape(a.severity),
        csvEscape(a.package),
        csvEscape(a.title),
        csvEscape(a.versionRange),
        csvEscape(a.url),
      ].join(','),
    );
  }
  // CRLF per RFC 4180. Excel happy either way; CRLF is the canonical form.
  return lines.join('\r\n');
}

function todayYyyyMmDd(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function downloadCsv(rows: SecurityAdvisory[]): void {
  // BOM (\uFEFF) so Excel auto-detects UTF-8 and renders Korean cells correctly.
  const csv = `\uFEFF${buildCsv(rows)}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `vulnerabilities-${todayYyyyMmDd()}.csv`;
  // Some browsers require the anchor to be in the DOM for the click to fire.
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Defer revocation so Safari has a tick to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
