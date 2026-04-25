'use client';

import * as React from 'react';
import { ArrowDownNarrowWide, ArrowUp, ArrowDown, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';

export type SortField = 'registeredAt' | 'number' | 'name';
export type SortDir = 'asc' | 'desc';

export interface SortValue {
  field: SortField;
  dir: SortDir;
}

interface SortMenuProps {
  value: SortValue;
  onChange: (next: SortValue) => void;
}

const FIELD_LABELS: Record<SortField, string> = {
  registeredAt: '등록일',
  number: '도면번호',
  name: '자료명',
};

export function sortLabel(value: SortValue): string {
  const arrow = value.dir === 'asc' ? '↑' : '↓';
  return `${FIELD_LABELS[value.field]} ${arrow}`;
}

/**
 * SortMenu — sort field + direction picker for the object list (BUG-010).
 *
 * The trigger is the toolbar's "정렬: …" button. Clicking opens a small menu
 * with three field options × asc/desc; selection only updates local state on
 * the caller side, so it must NOT trigger a parent re-render that touches the
 * sidebar.
 */
export function SortMenu({ value, onChange }: SortMenuProps) {
  const setField = (field: SortField) => onChange({ field, dir: value.dir });
  const toggleDir = () =>
    onChange({ field: value.field, dir: value.dir === 'asc' ? 'desc' : 'asc' });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="app-action-button h-8 px-2.5 text-xs"
          aria-label="정렬 옵션"
        >
          <ArrowDownNarrowWide className="h-3.5 w-3.5" />
          정렬: {sortLabel(value)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="min-w-[12rem]">
        <DropdownMenuLabel>정렬 기준</DropdownMenuLabel>
        {(Object.keys(FIELD_LABELS) as SortField[]).map((field) => {
          const active = field === value.field;
          return (
            <DropdownMenuItem
              key={field}
              onSelect={(e) => {
                e.preventDefault();
                setField(field);
              }}
            >
              <Check
                className={cn(
                  'h-3.5 w-3.5',
                  active ? 'text-fg' : 'text-transparent',
                )}
              />
              <span className={cn(active && 'font-medium text-fg')}>
                {FIELD_LABELS[field]}
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>정렬 방향</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            toggleDir();
          }}
        >
          {value.dir === 'asc' ? (
            <ArrowUp className="text-fg-muted" />
          ) : (
            <ArrowDown className="text-fg-muted" />
          )}
          <span>{value.dir === 'asc' ? '오름차순' : '내림차순'}</span>
          <span className="ml-auto text-[11px] text-fg-subtle">전환</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
