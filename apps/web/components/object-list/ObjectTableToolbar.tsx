'use client';

import { Filter, ArrowDownNarrowWide, X, Trash2, Upload, Download, FolderInput, Copy, Send } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ObjectTableToolbarProps {
  totalCount: number;
  selectedCount: number;
  search: string;
  onSearchChange: (v: string) => void;
  onClearFilters?: () => void;
  /** active filter chips */
  activeFilters?: { key: string; label: string; value: string }[];
  onRemoveFilter?: (key: string) => void;
  /** sort label like "등록일 ↓" */
  sortLabel?: string;
  onSortClick?: () => void;
  /** selection actions handlers (placeholders) */
  onMove?: () => void;
  onCopy?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  onSubmitApproval?: () => void;
}

export function ObjectTableToolbar({
  totalCount,
  selectedCount,
  search,
  onSearchChange,
  onClearFilters,
  activeFilters = [],
  onRemoveFilter,
  sortLabel = '등록일 ↓',
  onSortClick,
  onMove,
  onCopy,
  onDownload,
  onDelete,
  onSubmitApproval,
}: ObjectTableToolbarProps) {
  return (
    <div className="border-b border-border bg-bg">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 text-sm text-fg',
            'hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          필터
        </button>

        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="결과 내 검색…"
          className="h-8 w-64 rounded-md border border-border bg-bg-subtle px-2 text-sm placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {activeFilters.map((f) => (
          <span
            key={f.key}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-bg-subtle px-2 text-[12px] text-fg"
          >
            <span className="text-fg-muted">{f.label}:</span>
            <span>{f.value}</span>
            {onRemoveFilter && (
              <button
                type="button"
                onClick={() => onRemoveFilter(f.key)}
                aria-label={`${f.label} 필터 제거`}
                className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-fg-muted hover:bg-bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}

        {activeFilters.length > 0 && onClearFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="text-[12px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            필터 초기화
          </button>
        )}

        <div className="ml-auto flex items-center gap-3 text-[12px] text-fg-muted">
          <span>
            검색결과 <span className="font-semibold text-fg">{totalCount.toLocaleString()}</span>건
          </span>
          <button
            type="button"
            onClick={onSortClick}
            className="inline-flex h-7 items-center gap-1 rounded border border-border bg-bg px-1.5 text-fg hover:bg-bg-muted"
          >
            <ArrowDownNarrowWide className="h-3.5 w-3.5" />
            정렬: {sortLabel}
          </button>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex items-center gap-2 border-t border-border bg-brand/5 px-3 py-1.5 text-sm">
          <span className="font-medium text-fg">{selectedCount}건 선택됨</span>
          <span className="mx-2 text-border-strong">|</span>
          <ToolbarAction icon={<FolderInput className="h-3.5 w-3.5" />} label="이동" onClick={onMove} />
          <ToolbarAction icon={<Copy className="h-3.5 w-3.5" />} label="복사" onClick={onCopy} />
          <ToolbarAction icon={<Download className="h-3.5 w-3.5" />} label="다운로드" onClick={onDownload} />
          <ToolbarAction icon={<Send className="h-3.5 w-3.5" />} label="결재상신" onClick={onSubmitApproval} />
          <ToolbarAction
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="삭제"
            onClick={onDelete}
            destructive
          />
          <ToolbarAction icon={<Upload className="h-3.5 w-3.5" />} label="신규" />
        </div>
      )}
    </div>
  );
}

function ToolbarAction({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded px-1.5 text-[12px] hover:bg-bg-muted',
        destructive ? 'text-rose-600 hover:bg-rose-500/10' : 'text-fg',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
