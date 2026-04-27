'use client';

import * as React from 'react';
import { Search, Undo2, UserRound, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RoleBadge } from '@/components/admin/users/RoleBadge';
import type {
  AdminUserListItem,
  UserRole,
} from '@/components/admin/users/types';
import { isInactive } from '@/components/admin/users/types';
import { cn } from '@/lib/cn';

import {
  type AdminGroupListItem,
  type AdminGroupMember,
  type MembershipRow,
  deriveRowState,
} from './types';

/**
 * R30 §B.4 — GroupMembershipMatrix.
 *
 * State model: `originIds` (server snapshot) + `currentIds` (UI state). Dirty
 * count = symmetric diff. The header surfaces ▴N 변경 (추가 X / 제거 Y) and
 * delegates [저장] to the caller via `onSave(userIds)` (full-replace PUT).
 *
 * PM-DECISION-6 default — two queries merged client-side: members + admin
 * users list. Both are passed in as props so the page can wire infinite
 * scroll over the candidate pool. Member rows are pinned to the top.
 *
 * PM-DECISION-9 — Cmd/Ctrl+S triggers save, Cmd/Ctrl+Z reverts (Layer 2).
 */
export interface GroupMembershipMatrixProps {
  group: AdminGroupListItem;
  /** Server snapshot — origin truth. */
  initialMembers: AdminGroupMember[];
  /** Candidate user pool (from /api/v1/admin/users with cursor). */
  candidateUsers: AdminUserListItem[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loading?: boolean;
  /** Search/filter state — caller-managed for URL sync. */
  q: string;
  onChangeQ: (v: string) => void;
  roleFilter: 'all' | UserRole;
  onChangeRole: (v: 'all' | UserRole) => void;
  membersOnly: boolean;
  onChangeMembersOnly: (v: boolean) => void;
  onSave: (userIds: string[]) => Promise<void>;
  onDirtyCountChange?: (count: number) => void;
  readOnly?: boolean;
}

const ROLE_FILTER_OPTIONS: Array<{ value: 'all' | UserRole; label: string }> = [
  { value: 'all', label: '전체 역할' },
  { value: 'SUPER_ADMIN', label: '슈퍼관리자' },
  { value: 'ADMIN', label: '관리자' },
  { value: 'USER', label: '사용자' },
  { value: 'PARTNER', label: '협력업체' },
];

export function GroupMembershipMatrix({
  group,
  initialMembers,
  candidateUsers,
  onLoadMore,
  hasMore,
  loadingMore,
  loading,
  q,
  onChangeQ,
  roleFilter,
  onChangeRole,
  membersOnly,
  onChangeMembersOnly,
  onSave,
  onDirtyCountChange,
  readOnly,
}: GroupMembershipMatrixProps): JSX.Element {
  // ── Origin snapshot + current set ────────────────────────────────────
  const originIds = React.useMemo(
    () => new Set(initialMembers.map((m) => m.id)),
    [initialMembers],
  );
  const [currentIds, setCurrentIds] = React.useState<Set<string>>(originIds);

  // Re-seed on group change. Important: do NOT reset on every initialMembers
  // re-render (cache refetch) — only on identity change, signaled by group id.
  const lastGroupId = React.useRef(group.id);
  React.useEffect(() => {
    if (lastGroupId.current !== group.id) {
      setCurrentIds(originIds);
      lastGroupId.current = group.id;
    } else {
      // Same group, but origin changed (after save success). Reset to origin
      // only when we're not dirty (otherwise we'd nuke the user's edits).
      setCurrentIds((prev) => {
        // After successful save, the new origin equals the prev currentIds —
        // simplest correct behavior is to re-seed.
        const prevIds = Array.from(prev);
        const nextIds = Array.from(originIds);
        if (
          prevIds.length === nextIds.length &&
          prevIds.every((id) => originIds.has(id))
        ) {
          return originIds;
        }
        return prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, originIds]);

  // ── Derived sets ─────────────────────────────────────────────────────
  const addedIds = React.useMemo(() => {
    const out = new Set<string>();
    for (const id of currentIds) if (!originIds.has(id)) out.add(id);
    return out;
  }, [currentIds, originIds]);
  const removedIds = React.useMemo(() => {
    const out = new Set<string>();
    for (const id of originIds) if (!currentIds.has(id)) out.add(id);
    return out;
  }, [currentIds, originIds]);
  const dirtyCount = addedIds.size + removedIds.size;

  React.useEffect(() => {
    onDirtyCountChange?.(dirtyCount);
  }, [dirtyCount, onDirtyCountChange]);

  // ── beforeunload guard (Layer 3) ─────────────────────────────────────
  React.useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyCount]);

  // ── Build the unified row list ───────────────────────────────────────
  // Members are pinned to the top, then candidates that aren't already in the
  // member list. We dedupe by user id.
  const allRows: MembershipRow[] = React.useMemo(() => {
    const seen = new Set<string>();
    const out: MembershipRow[] = [];
    for (const m of initialMembers) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const current = currentIds.has(m.id);
      out.push({
        user: {
          id: m.id,
          username: m.username,
          fullName: m.fullName,
          role: m.role,
          organizationId: m.organizationId,
          organizationName: m.organizationName ?? null,
          deletedAt: m.deletedAt ?? null,
        },
        origin: true,
        current,
        state: deriveRowState(true, current),
      });
    }
    for (const u of candidateUsers) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      const origin = originIds.has(u.id);
      const current = currentIds.has(u.id);
      out.push({
        user: {
          id: u.id,
          username: u.username,
          fullName: u.fullName,
          role: u.role,
          organizationId: u.organizationId,
          organizationName: u.organization?.name ?? null,
          deletedAt: u.deletedAt ?? null,
        },
        origin,
        current,
        state: deriveRowState(origin, current),
      });
    }
    return out;
  }, [initialMembers, candidateUsers, originIds, currentIds]);

  // ── Apply the toolbar filters ────────────────────────────────────────
  const visibleRows = React.useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return allRows.filter((row) => {
      const u = row.user;
      // Hide soft-deleted users unless they're current members (we'll show
      // them strikethrough so admins can manually clear them).
      if (isInactive(u as unknown as AdminUserListItem)) {
        if (!row.origin && !row.current) return false;
      }
      if (qLower) {
        const hay = `${u.fullName} ${u.username} ${u.organizationName ?? ''}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (membersOnly) {
        // include if currently checked OR was origin (so the admin can see
        // their pending removals).
        if (!row.current && !row.origin) return false;
      }
      return true;
    });
  }, [allRows, q, roleFilter, membersOnly]);

  // ── Bulk toggle (column header) — operates on visibleRows ────────────
  const visibleCheckedCount = visibleRows.filter((r) => r.current).length;
  const visibleCount = visibleRows.length;
  const headerState: 'all-on' | 'all-off' | 'mixed' =
    visibleCount === 0
      ? 'all-off'
      : visibleCheckedCount === visibleCount
        ? 'all-on'
        : visibleCheckedCount === 0
          ? 'all-off'
          : 'mixed';
  const headerCheckboxValue: boolean | 'indeterminate' =
    headerState === 'all-on'
      ? true
      : headerState === 'mixed'
        ? 'indeterminate'
        : false;

  const announceRef = React.useRef<HTMLDivElement>(null);
  const announce = React.useCallback((msg: string) => {
    if (announceRef.current) {
      announceRef.current.textContent = msg;
    }
  }, []);

  const handleHeaderToggle = () => {
    if (readOnly || visibleCount === 0) return;
    setCurrentIds((prev) => {
      const next = new Set(prev);
      if (headerState === 'all-on') {
        let removed = 0;
        for (const r of visibleRows) {
          if (next.has(r.user.id)) {
            next.delete(r.user.id);
            removed++;
          }
        }
        announce(`${removed}명 제거. 현재 변경 ${dirtyCount}건.`);
      } else {
        let added = 0;
        for (const r of visibleRows) {
          if (
            !next.has(r.user.id) &&
            !isInactive(r.user as unknown as AdminUserListItem)
          ) {
            next.add(r.user.id);
            added++;
          }
        }
        announce(`${added}명 추가. 현재 변경 ${dirtyCount}건.`);
      }
      return next;
    });
  };

  const handleRowToggle = (id: string) => {
    if (readOnly) return;
    setCurrentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Save / revert ────────────────────────────────────────────────────
  const [saving, setSaving] = React.useState(false);
  const handleSave = React.useCallback(async () => {
    if (dirtyCount === 0 || readOnly || saving) return;
    try {
      setSaving(true);
      await onSave(Array.from(currentIds));
      // Caller is expected to invalidate ['admin','groups',id,'members'];
      // when the new initialMembers arrives, the re-seed effect aligns
      // currentIds with the new origin.
    } finally {
      setSaving(false);
    }
  }, [currentIds, dirtyCount, readOnly, saving, onSave]);

  const [revertOpen, setRevertOpen] = React.useState(false);
  const performRevert = () => {
    setCurrentIds(new Set(originIds));
    setRevertOpen(false);
    announce(`변경사항이 되돌려졌습니다.`);
  };

  // Cmd/Ctrl+S, Cmd/Ctrl+Z (PM-DECISION-9).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void handleSave();
      } else if (key === 'z') {
        e.preventDefault();
        if (dirtyCount > 0) setRevertOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave, dirtyCount]);

  // ── Auto-load more on intersection (R29 pattern) ─────────────────────
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!hasMore || !onLoadMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !loadingMore) {
            onLoadMore();
          }
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, loadingMore]);

  return (
    <section
      aria-label="그룹 멤버십 매트릭스"
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg"
    >
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-fg">
              {group.name}
            </h2>
            {group.description ? (
              <p className="mt-0.5 line-clamp-1 text-sm text-fg-muted">
                {group.description}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-fg-muted">
              <span className="tabular-nums">{currentIds.size}</span>명 멤버
              {dirtyCount > 0 ? (
                <>
                  <span className="mx-2 text-fg-subtle">·</span>
                  <span className="font-medium text-amber-700">
                    ▴{dirtyCount} 변경
                  </span>{' '}
                  <span className="text-fg-muted">
                    (추가 {addedIds.size} / 제거 {removedIds.size})
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRevertOpen(true)}
              disabled={dirtyCount === 0 || readOnly}
            >
              <Undo2 className="h-3.5 w-3.5" />
              되돌리기
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={dirtyCount === 0 || readOnly || saving}
            >
              {saving ? '저장 중...' : `저장 (${dirtyCount})`}
            </Button>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="relative flex-1 min-w-[240px]">
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
        <Select
          value={roleFilter}
          onValueChange={(v) => onChangeRole(v as 'all' | UserRole)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_FILTER_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => onChangeMembersOnly(!membersOnly)}
          aria-pressed={membersOnly}
          className={cn(
            'inline-flex h-9 items-center gap-1 rounded-md border px-3 text-xs',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            membersOnly
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border text-fg-muted hover:bg-bg-muted hover:text-fg',
          )}
        >
          멤버만 보기
        </button>
      </div>

      {/* Matrix body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {/* Column header */}
        <div
          role="row"
          className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg-subtle px-4 py-2 text-xs"
        >
          <button
            type="button"
            onClick={handleHeaderToggle}
            aria-pressed={headerState === 'all-on'}
            aria-label="현재 보이는 사용자 일괄 추가/제거"
            className="flex h-5 w-5 items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-ring"
            disabled={readOnly || visibleCount === 0}
          >
            <Checkbox
              checked={headerCheckboxValue}
              tabIndex={-1}
              aria-hidden="true"
              className="pointer-events-none"
            />
          </button>
          <span className="text-fg-muted">
            사용자 ({visibleCheckedCount} / {visibleCount})
          </span>
        </div>

        <ul role="list" className="flex-1">
          {loading ? (
            <li className="p-4 text-xs text-fg-subtle">불러오는 중...</li>
          ) : visibleRows.length === 0 ? (
            <li className="p-6 text-center text-xs text-fg-subtle">
              조건에 맞는 사용자가 없습니다.
            </li>
          ) : (
            visibleRows.map((row) => {
              const inactive = isInactive(
                row.user as unknown as AdminUserListItem,
              );
              return (
                <li
                  key={row.user.id}
                  className={cn(
                    'flex items-center gap-2 border-b border-border-subtle px-4 py-2 text-sm transition-colors',
                    row.state === 'added' &&
                      'border-l-2 border-l-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20',
                    row.state === 'removed' &&
                      'border-l-2 border-l-rose-400 bg-rose-50/30 dark:bg-rose-950/20',
                  )}
                >
                  <Checkbox
                    checked={row.current}
                    onCheckedChange={() => handleRowToggle(row.user.id)}
                    disabled={readOnly || inactive}
                    aria-label={`${row.user.fullName} (${row.user.username}) 그룹 포함`}
                  />
                  <span className="flex flex-1 items-center gap-2 min-w-0">
                    <UserRound className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                    <span
                      className={cn(
                        'truncate text-sm',
                        inactive && 'text-fg-subtle line-through',
                      )}
                    >
                      {row.user.fullName}
                    </span>
                    <span className="font-mono-num text-[11px] text-fg-muted">
                      ({row.user.username})
                    </span>
                    <RoleBadge role={row.user.role} />
                    {row.user.organizationName ? (
                      <span className="truncate text-xs text-fg-muted">
                        {row.user.organizationName}
                      </span>
                    ) : null}
                    {inactive ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        비활성
                      </span>
                    ) : null}
                  </span>
                  <span className="w-[60px] text-right text-xs">
                    {row.state === 'added' ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        ▴추가
                      </span>
                    ) : row.state === 'removed' ? (
                      <span className="text-rose-700 dark:text-rose-400">
                        ▴제거
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })
          )}
        </ul>

        {hasMore ? (
          <div ref={sentinelRef} className="flex justify-center py-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onLoadMore?.()}
              disabled={loadingMore}
            >
              {loadingMore ? '불러오는 중...' : '더 보기'}
            </Button>
          </div>
        ) : null}
      </div>

      <div
        ref={announceRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      <ConfirmDialog
        open={revertOpen}
        onOpenChange={setRevertOpen}
        title="변경사항을 되돌리시겠습니까?"
        description={`변경사항 ${dirtyCount}건이 모두 사라집니다.`}
        confirmText="되돌리기"
        cancelText="취소"
        variant="destructive"
        onConfirm={() => performRevert()}
      />
    </section>
  );
}
