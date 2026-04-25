'use client';

import Link from 'next/link';
import {
  Filter,
  ArrowDownNarrowWide,
  Trash2,
  Download,
  FolderInput,
  Copy,
  Send,
  Search,
  Plus,
  Layers3,
  GitCompare,
  Archive,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { FilterChip } from '@/components/FilterChip';

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
    <div className="app-toolbar">
      <div className="flex min-h-12 flex-wrap items-center gap-2 px-4 py-2">
        <div className="inline-flex h-8 rounded-md border border-border bg-bg-subtle p-0.5">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-bg px-2 text-[12px] font-semibold text-fg shadow-sm ring-1 ring-border"
          >
            <Layers3 className="h-3.5 w-3.5 text-brand" />
            문서 그리드
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-2 text-[12px] font-medium text-fg-muted hover:bg-bg-muted hover:text-fg"
          >
            시트 세트
          </button>
        </div>

        <div className="relative min-w-72 flex-1 max-w-xl">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="도면번호, 자료명, PDF 내용 검색..."
            className="h-8 w-full rounded-md border border-border bg-bg px-8 text-sm placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <button
          type="button"
          className={cn(
            'app-action-button',
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          속성 필터
        </button>

        {activeFilters.map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            value={f.value}
            onRemove={onRemoveFilter ? () => onRemoveFilter(f.key) : undefined}
            readOnly={!onRemoveFilter}
          />
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

        <div className="ml-auto flex items-center gap-2 text-[12px] text-fg-muted">
          <span>
            총 <span className="font-semibold text-fg">{totalCount.toLocaleString()}</span>건
          </span>
          <button
            type="button"
            onClick={onSortClick}
            className="app-action-button h-8 px-2.5 text-xs"
          >
            <ArrowDownNarrowWide className="h-3.5 w-3.5" />
            정렬: {sortLabel}
          </button>
          <Link href="/search?action=new" className="app-action-button-primary h-8">
            <Plus className="h-3.5 w-3.5" />
            신규 등록
          </Link>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex items-center gap-2 border-t border-border bg-brand/5 px-4 py-2 text-sm">
          <span className="font-medium text-fg">{selectedCount}건 선택됨</span>
          <span className="mx-2 text-border-strong">|</span>
          <ToolbarAction icon={<FolderInput className="h-3.5 w-3.5" />} label="이동" onClick={onMove} />
          <ToolbarAction icon={<Copy className="h-3.5 w-3.5" />} label="복사" onClick={onCopy} />
          <ToolbarAction icon={<GitCompare className="h-3.5 w-3.5" />} label="리비전 비교" />
          <ToolbarAction icon={<Download className="h-3.5 w-3.5" />} label="다운로드" onClick={onDownload} />
          <ToolbarAction icon={<Send className="h-3.5 w-3.5" />} label="결재상신" onClick={onSubmitApproval} />
          <ToolbarAction icon={<Archive className="h-3.5 w-3.5" />} label="트랜스미털" />
          <ToolbarAction
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="삭제"
            onClick={onDelete}
            destructive
          />
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
        destructive ? 'text-danger hover:bg-danger/10' : 'text-fg',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
