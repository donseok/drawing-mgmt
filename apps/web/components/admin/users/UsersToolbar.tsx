'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { StatusFilter, UserRole } from './types';

/**
 * R29 §A.3 — Filter+Action toolbar. Search input, role select, status select,
 * "필터 초기화". Search debouncing is owned by the caller (page) so it can
 * tie into URL sync.
 */

export interface UsersToolbarProps {
  q: string;
  role: 'all' | UserRole;
  status: StatusFilter;
  onChangeQ: (next: string) => void;
  onChangeRole: (next: 'all' | UserRole) => void;
  onChangeStatus: (next: StatusFilter) => void;
  onReset: () => void;
}

const ROLE_FILTERS: Array<{ value: 'all' | UserRole; label: string }> = [
  { value: 'all', label: '전체 역할' },
  { value: 'SUPER_ADMIN', label: '슈퍼관리자' },
  { value: 'ADMIN', label: '관리자' },
  { value: 'USER', label: '사용자' },
  { value: 'PARTNER', label: '협력업체' },
];

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '전체 상태' },
  { value: 'active', label: '재직' },
  { value: 'locked', label: '잠김' },
  { value: 'inactive', label: '비활성' },
];

export function UsersToolbar({
  q,
  role,
  status,
  onChangeQ,
  onChangeRole,
  onChangeStatus,
  onReset,
}: UsersToolbarProps): JSX.Element {
  const isFiltered = q.length > 0 || role !== 'all' || status !== 'active';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[280px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={q}
          onChange={(e) => onChangeQ(e.target.value)}
          placeholder="이름 · 사번 · 이메일 검색"
          className="pl-8 pr-8"
          aria-label="사용자 검색"
        />
        {q ? (
          <button
            type="button"
            aria-label="검색어 지우기"
            onClick={() => onChangeQ('')}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-fg-muted hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <Select value={role} onValueChange={(v) => onChangeRole(v as 'all' | UserRole)}>
        <SelectTrigger className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLE_FILTERS.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={status}
        onValueChange={(v) => onChangeStatus(v as StatusFilter)}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_FILTERS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isFiltered ? (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs text-fg-muted hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3 w-3" />
          필터 초기화
        </button>
      ) : null}
    </div>
  );
}
