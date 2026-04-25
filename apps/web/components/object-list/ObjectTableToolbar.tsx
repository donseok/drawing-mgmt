'use client';

import * as React from 'react';
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
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { FilterChip } from '@/components/FilterChip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SortMenu, sortLabel, type SortValue } from './SortMenu';

export interface FilterFormValue {
  classCode?: string;
  state?: string;
  registeredFrom?: string;
  registeredTo?: string;
  registrant?: string;
}

interface ObjectTableToolbarProps {
  totalCount: number;
  selectedCount: number;
  search: string;
  onSearchChange: (v: string) => void;
  onClearFilters?: () => void;
  /** active filter chips */
  activeFilters?: { key: string; label: string; value: string }[];
  onRemoveFilter?: (key: string) => void;
  /** sort state + handler (BUG-010) */
  sort?: SortValue;
  onSortChange?: (next: SortValue) => void;
  /** filter form state + handler (BUG-006) */
  filterValue?: FilterFormValue;
  onFilterChange?: (next: FilterFormValue) => void;
  /** selection actions handlers (placeholders) */
  onMove?: () => void;
  onCopy?: () => void;
  onDownload?: () => void;
  /**
   * Bulk delete. Toolbar guards this behind a ConfirmDialog (DESIGN §9.3) — caller
   * just performs the actual mutation and may throw on failure for a toast.
   */
  onDelete?: () => void | Promise<void>;
  onSubmitApproval?: () => void;
}

const DEFAULT_SORT: SortValue = { field: 'registeredAt', dir: 'desc' };

const CLASS_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'MEC', label: '기계' },
  { value: 'ELE', label: '전기' },
  { value: 'INS', label: '계장' },
  { value: 'PRC', label: '공정' },
];

const STATE_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'NEW', label: '신규' },
  { value: 'CHECKED_OUT', label: '체크아웃' },
  { value: 'CHECKED_IN', label: '체크인' },
  { value: 'IN_APPROVAL', label: '결재중' },
  { value: 'APPROVED', label: '승인완료' },
];

export function ObjectTableToolbar({
  totalCount,
  selectedCount,
  search,
  onSearchChange,
  onClearFilters,
  activeFilters = [],
  onRemoveFilter,
  sort = DEFAULT_SORT,
  onSortChange,
  filterValue,
  onFilterChange,
  onMove,
  onCopy,
  onDownload,
  onDelete,
  onSubmitApproval,
}: ObjectTableToolbarProps) {
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<FilterFormValue>(filterValue ?? {});
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  const handleConfirmDelete = async () => {
    try {
      await onDelete?.();
      toast.success(`${selectedCount}건을 삭제했습니다.`);
      setConfirmDeleteOpen(false);
    } catch (err) {
      toast.error('삭제에 실패했습니다.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  // Sync draft -> external when popover opens.
  React.useEffect(() => {
    if (filterOpen) setDraft(filterValue ?? {});
  }, [filterOpen, filterValue]);

  const apply = () => {
    onFilterChange?.(draft);
    setFilterOpen(false);
  };

  const reset = () => {
    const empty: FilterFormValue = {};
    setDraft(empty);
    onFilterChange?.(empty);
  };

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

        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="필터 조건"
              className={cn(
                'app-action-button',
                filterOpen && 'border-border-strong bg-bg-muted',
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              필터 조건
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            className="w-80 space-y-3 p-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fg">필터 조건</h3>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => setFilterOpen(false)}
                className="app-icon-button h-6 w-6"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <FilterField label="자료유형">
              <select
                value={draft.classCode ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, classCode: e.target.value || undefined }))
                }
                className="h-8 w-full rounded-md border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {CLASS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="상태">
              <select
                value={draft.state ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, state: e.target.value || undefined }))
                }
                className="h-8 w-full rounded-md border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {STATE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="등록일">
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={draft.registeredFrom ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, registeredFrom: e.target.value || undefined }))
                  }
                  className="h-8 w-full flex-1 rounded-md border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="text-fg-subtle">~</span>
                <input
                  type="date"
                  value={draft.registeredTo ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, registeredTo: e.target.value || undefined }))
                  }
                  className="h-8 w-full flex-1 rounded-md border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </FilterField>

            <FilterField label="등록자">
              <input
                type="text"
                value={draft.registrant ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, registrant: e.target.value || undefined }))
                }
                placeholder="이름 입력"
                className="h-8 w-full rounded-md border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </FilterField>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={reset}
                className="app-action-button h-8 px-3 text-xs"
              >
                초기화
              </button>
              <button
                type="button"
                onClick={apply}
                className="app-action-button-primary h-8 px-3 text-xs"
              >
                적용
              </button>
            </div>
          </PopoverContent>
        </Popover>

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
          {onSortChange ? (
            <SortMenu value={sort} onChange={onSortChange} />
          ) : (
            <span className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-bg-subtle px-2.5 text-xs text-fg-muted">
              정렬: {sortLabel(sort)}
            </span>
          )}
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
            onClick={onDelete ? () => setConfirmDeleteOpen(true) : undefined}
            destructive
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`선택한 ${selectedCount}건을 삭제하시겠습니까?`}
        description="이 작업은 되돌릴 수 없습니다. 삭제된 항목은 휴지통으로 이동합니다."
        confirmText="삭제"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase text-fg-subtle">
        {label}
      </span>
      {children}
    </label>
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
