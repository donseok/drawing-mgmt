'use client';

import * as React from 'react';
import { MoreVertical, Pencil, Search, Trash2, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

import type { AdminGroupListItem } from './types';

/**
 * R30 §B.3 — Group list (left sub-sidebar). Client-side substring filter on
 * name + description (PM-DECISION-5: BE search not needed at <=200 groups).
 * Each row: name + description + memberCount + hover-revealed `[⋮]` menu.
 */
export interface GroupListPanelProps {
  groups: AdminGroupListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (group: AdminGroupListItem) => void;
  onDelete: (group: AdminGroupListItem) => void;
  searchValue: string;
  onSearchChange: (next: string) => void;
  loading?: boolean;
}

export function GroupListPanel({
  groups,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  searchValue,
  onSearchChange,
  loading,
}: GroupListPanelProps): JSX.Element {
  const filtered = React.useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => {
      const name = g.name.toLowerCase();
      const desc = (g.description ?? '').toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [groups, searchValue]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="그룹 검색"
            className="pl-8 pr-8"
            aria-label="그룹 검색"
          />
          {searchValue ? (
            <button
              type="button"
              aria-label="검색어 지우기"
              onClick={() => onSearchChange('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-fg-muted hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-fg-subtle">
            {searchValue ? (
              <>
                검색 결과 없음{' '}
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="ml-1 text-brand hover:underline"
                >
                  초기화
                </button>
              </>
            ) : (
              '등록된 그룹이 없습니다'
            )}
          </div>
        ) : (
          <ul role="list" className="divide-y divide-border">
            {filtered.map((g) => {
              const selected = g.id === selectedId;
              return (
                <li key={g.id}>
                  <div
                    className={cn(
                      'group relative flex cursor-pointer items-start gap-2 px-3 py-2 transition-colors',
                      'hover:bg-bg-muted',
                      selected &&
                        'border-l-2 border-brand bg-brand/10 pl-[10px]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(g.id)}
                      className="flex flex-1 flex-col items-start gap-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="text-sm font-medium text-fg">
                        {g.name}
                      </span>
                      {g.description ? (
                        <span className="line-clamp-1 text-xs text-fg-muted">
                          {g.description}
                        </span>
                      ) : null}
                    </button>
                    <span className="ml-1 self-center text-xs tabular-nums text-fg-muted">
                      {g.memberCount}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${g.name} 그룹 메뉴`}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-subtle opacity-0 hover:bg-bg-muted hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onEdit(g)}>
                          <Pencil className="h-4 w-4" />
                          수정
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          destructive
                          onSelect={() => onDelete(g)}
                        >
                          <Trash2 className="h-4 w-4" />
                          삭제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
