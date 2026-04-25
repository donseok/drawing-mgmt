'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * RevisionTree — DESIGN §7 (자체 컴포넌트), §6.4 이력 탭.
 *
 * Shape:
 *   R3 ▼   2026-04-15  박영호
 *      ├ v0.2 (현재)   체크인됨    [열기] [되돌리기]
 *      └ v0.1          —
 *   R2 ▶   2026-03-02  박영호  (collapsed)
 *
 * UI shell only — wires no data fetching. Parent is responsible for:
 *   - sorting (default: revision desc, version desc)
 *   - flagging "current" version
 *   - rendering action buttons via `versionActions` slot
 */

export interface RevisionVersion {
  /** Version label, e.g. "v0.2", "0.1". */
  version: string;
  /** Optional state label rendered inline (e.g. "체크인됨"). */
  state?: React.ReactNode;
  /** Mark this row as the current version. */
  current?: boolean;
  /** Created-at, render-ready string. */
  createdAt?: string;
  /** Created-by, render-ready string. */
  createdBy?: string;
}

export interface RevisionGroup {
  /** Revision label, e.g. "R3". */
  rev: string;
  /** Versions inside this revision. Renders top-to-bottom as given. */
  versions: RevisionVersion[];
  /** Optional revision-level metadata. */
  createdAt?: string;
  createdBy?: string;
  /** Default expansion state. Defaults to true on the first (latest) revision. */
  defaultOpen?: boolean;
}

export interface RevisionTreeProps extends React.HTMLAttributes<HTMLDivElement> {
  revisions: RevisionGroup[];
  /** Render slot for per-version actions (`[열기] [되돌리기]`). */
  versionActions?: (rev: RevisionGroup, version: RevisionVersion) => React.ReactNode;
  /** Click handler for a version row. */
  onVersionClick?: (rev: RevisionGroup, version: RevisionVersion) => void;
}

export function RevisionTree({
  revisions,
  versionActions,
  onVersionClick,
  className,
  ...props
}: RevisionTreeProps) {
  if (revisions.length === 0) {
    return (
      <div
        className={cn(
          'rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted',
          className,
        )}
        {...props}
      >
        리비전 이력이 없습니다.
      </div>
    );
  }

  return (
    <div
      className={cn('flex flex-col gap-1', className)}
      role="tree"
      aria-label="리비전 / 버전 트리"
      {...props}
    >
      {revisions.map((rev, idx) => (
        <RevisionRow
          key={rev.rev}
          rev={rev}
          defaultOpen={rev.defaultOpen ?? idx === 0}
          versionActions={versionActions}
          onVersionClick={onVersionClick}
        />
      ))}
    </div>
  );
}

interface RevisionRowProps {
  rev: RevisionGroup;
  defaultOpen: boolean;
  versionActions?: RevisionTreeProps['versionActions'];
  onVersionClick?: RevisionTreeProps['onVersionClick'];
}

function RevisionRow({
  rev,
  defaultOpen,
  versionActions,
  onVersionClick,
}: RevisionRowProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left',
          'hover:bg-bg-subtle transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-fg-muted shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-fg-muted shrink-0" />
        )}
        <GitBranch className="h-3.5 w-3.5 text-fg-subtle shrink-0" />
        <span className="font-mono-num text-[13px] font-medium text-fg">{rev.rev}</span>
        <span className="text-xs text-fg-muted">·</span>
        <span className="text-xs text-fg-muted">{rev.versions.length}개 버전</span>
        {rev.createdAt ? (
          <span className="ml-auto font-mono-num text-xs text-fg-muted">{rev.createdAt}</span>
        ) : null}
        {rev.createdBy ? (
          <span className="text-xs text-fg-muted">{rev.createdBy}</span>
        ) : null}
      </button>

      {open ? (
        <ul role="group" className="border-t border-border">
          {rev.versions.map((version) => (
            <li
              key={`${rev.rev}-${version.version}`}
              role="treeitem"
              aria-current={version.current ? 'true' : undefined}
              className={cn(
                'flex items-center gap-3 pl-9 pr-3 py-2 text-sm border-b last:border-b-0 border-border',
                'hover:bg-bg-subtle transition-colors',
                version.current && 'bg-brand/5',
                onVersionClick && 'cursor-pointer',
              )}
              onClick={() => onVersionClick?.(rev, version)}
            >
              <span className="font-mono-num text-[13px] text-fg">{version.version}</span>
              {version.current ? (
                <span className="rounded-sm bg-brand/15 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                  현재
                </span>
              ) : null}
              {version.state ? (
                <span className="text-xs text-fg-muted">{version.state}</span>
              ) : null}
              <div className="ml-auto flex items-center gap-3">
                {version.createdBy ? (
                  <span className="text-xs text-fg-muted">{version.createdBy}</span>
                ) : null}
                {version.createdAt ? (
                  <span className="font-mono-num text-xs text-fg-subtle">
                    {version.createdAt}
                  </span>
                ) : null}
                {versionActions ? (
                  <div className="flex items-center gap-1">{versionActions(rev, version)}</div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
