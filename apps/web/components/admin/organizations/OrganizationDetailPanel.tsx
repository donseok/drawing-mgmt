'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronRight,
  Copy,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { RoleBadge } from '@/components/admin/users/RoleBadge';
import type { UserRole } from '@/components/admin/users/types';
import { cn } from '@/lib/cn';

import type { AdminOrganization } from './types';

/**
 * R30 §A.5 — OrganizationDetailPanel. Three cards:
 *   1) 기본 정보 (id, name, parent, sortOrder ↑↓, counts).
 *   2) 자식 조직 (직속만, 클릭 시 트리에서 해당 자식 선택).
 *   3) 소속 사용자 (직속만, 선두 6명 + [모두 보기]).
 *
 * Card 3 is render-only; the page passes either `members` (loaded) or
 * `members={undefined} + membersLoading=true`. PM-DECISION-3: when the BE
 * doesn't support `?organizationId=` filter we render a fallback
 * "(N명) — 사용자 페이지에서 확인" empty state instead of crashing.
 */
export interface OrganizationDetailPanelProps {
  org: AdminOrganization | null;
  /** Same-parent siblings, sorted by sortOrder asc — required for ↑↓. */
  siblings: AdminOrganization[];
  /** Direct children of `org`, sorted. */
  childrenList: AdminOrganization[];
  breadcrumb: AdminOrganization[];
  /** Selected member preview (max 5). undefined = unsupported / not loaded. */
  members?: Array<{
    id: string;
    username: string;
    fullName: string;
    role: UserRole;
  }>;
  membersTotal?: number;
  membersLoading?: boolean;
  /** When members fetch failed/unsupported, render the fallback link. */
  membersUnsupported?: boolean;
  onEdit: () => void;
  onCreateChild: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSelectChild: (id: string) => void;
}

export function OrganizationDetailPanel({
  org,
  siblings,
  childrenList,
  breadcrumb,
  members,
  membersTotal,
  membersLoading,
  membersUnsupported,
  onEdit,
  onCreateChild,
  onDelete,
  onMoveUp,
  onMoveDown,
  onSelectChild,
}: OrganizationDetailPanelProps): JSX.Element {
  if (!org) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-12 py-10 text-center">
          <Building2 className="h-12 w-12 text-fg-subtle" strokeWidth={1.5} />
          <p className="text-sm font-medium text-fg">
            왼쪽 트리에서 조직을 선택해 편집하세요
          </p>
        </div>
      </div>
    );
  }

  const idx = siblings.findIndex((s) => s.id === org.id);
  const total = siblings.length;
  const isFirst = idx <= 0;
  const isLast = idx < 0 || idx >= total - 1;

  const hasChildren = org.childCount > 0;
  const hasUsers = org.userCount > 0;
  const blockedReason = (() => {
    if (hasChildren && hasUsers) {
      return `자식 조직 ${org.childCount}개와 소속 사용자 ${org.userCount}명이 있어 삭제할 수 없습니다.`;
    }
    if (hasChildren) {
      return `자식 조직 ${org.childCount}개를 먼저 삭제하거나 다른 부모로 이동하세요.`;
    }
    if (hasUsers) {
      return `소속 사용자 ${org.userCount}명을 먼저 다른 조직으로 옮기거나 비활성화하세요.`;
    }
    return null;
  })();

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(org.id);
      toast.success('ID를 복사했습니다');
    } catch {
      toast.error('복사할 수 없습니다');
    }
  };

  return (
    <section
      aria-label="조직 상세"
      className="flex min-h-0 flex-1 flex-col overflow-auto bg-bg"
    >
      {/* Header (sticky breadcrumb + actions) */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg/95 px-4 py-2 text-sm backdrop-blur">
        <nav
          aria-label="조직 경로"
          className="flex flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap font-mono-num text-[12px] text-fg-muted"
        >
          {breadcrumb.map((b, i) => {
            const last = i === breadcrumb.length - 1;
            return (
              <span key={b.id} className="flex items-center gap-1">
                {i > 0 ? (
                  <ChevronRight className="h-3 w-3 text-fg-subtle" />
                ) : null}
                <span
                  className={cn(
                    last ? 'font-medium text-fg' : 'text-fg-muted',
                  )}
                >
                  {b.name}
                </span>
              </span>
            );
          })}
        </nav>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> 편집
        </Button>
        <TooltipProvider>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="조직 더보기 메뉴"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {blockedReason ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/*
                      Wrap the disabled menu item so the tooltip can attach
                      a hint. Radix DropdownMenuItem with `disabled` doesn't
                      forward pointer events, so we use a div-rendered
                      surrogate that mirrors the disabled style.
                    */}
                    <div
                      role="menuitem"
                      aria-disabled="true"
                      tabIndex={-1}
                      className="relative flex select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-fg-subtle opacity-60"
                    >
                      <Trash2 className="h-4 w-4" />
                      삭제
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left">{blockedReason}</TooltipContent>
                </Tooltip>
              ) : (
                <DropdownMenuItem destructive onSelect={onDelete}>
                  <Trash2 className="h-4 w-4" />
                  삭제
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipProvider>
      </div>

      <div className="flex flex-col gap-4 p-6">
        {/* Card 1 — 기본 정보 */}
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
            기본 정보
          </div>
          <dl className="divide-y divide-border text-sm">
            <Row label="ID">
              <span className="flex items-center gap-2">
                <span className="font-mono-num text-[11px] text-fg-subtle">
                  {org.id}
                </span>
                <button
                  type="button"
                  onClick={copyId}
                  className="rounded p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
                  aria-label="ID 복사"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </span>
            </Row>
            <Row label="이름">{org.name}</Row>
            <Row label="부모 조직">
              {breadcrumb.length > 1
                ? breadcrumb[breadcrumb.length - 2]!.name
                : '(최상위)'}
            </Row>
            <Row label="정렬 순서">
              <span className="flex items-center gap-2">
                <span className="tabular-nums">
                  {idx >= 0 ? idx + 1 : '-'} / {total}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onMoveUp}
                  disabled={isFirst}
                  aria-label="위로 이동"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onMoveDown}
                  disabled={isLast}
                  aria-label="아래로 이동"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </span>
            </Row>
            <Row label="자식 조직">{org.childCount}개</Row>
            <Row label="소속 사용자">{org.userCount}명</Row>
          </dl>
        </div>

        {/* Card 2 — 자식 조직 */}
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-fg-muted">
              자식 조직 ({childrenList.length}개)
            </h3>
            <Button size="sm" variant="outline" onClick={onCreateChild}>
              <Plus className="h-3.5 w-3.5" />
              자식 조직 추가
            </Button>
          </div>
          {childrenList.length === 0 ? (
            <p className="px-4 py-3 text-xs text-fg-subtle">
              자식 조직이 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {childrenList.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelectChild(c.id)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-bg-muted"
                  >
                    <Building2 className="h-3.5 w-3.5 text-fg-muted" />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs tabular-nums text-fg-muted">
                      {c.userCount}명
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Card 3 — 소속 사용자 (직속만) */}
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
            소속 사용자 ({membersTotal ?? org.userCount}명)
          </div>
          {membersUnsupported ? (
            <div className="px-4 py-3 text-xs text-fg-subtle">
              {(membersTotal ?? org.userCount) > 0 ? (
                <a
                  href={`/admin/users?organizationId=${org.id}`}
                  className="text-brand hover:underline"
                >
                  사용자 페이지에서 확인 ({membersTotal ?? org.userCount}명) →
                </a>
              ) : (
                '소속 사용자가 없습니다.'
              )}
            </div>
          ) : membersLoading ? (
            <p className="px-4 py-3 text-xs text-fg-subtle">불러오는 중...</p>
          ) : !members || members.length === 0 ? (
            <p className="px-4 py-3 text-xs text-fg-subtle">
              소속 사용자가 없습니다.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border text-sm">
                {members.slice(0, 5).map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 px-4 py-2"
                  >
                    <span className="flex flex-1 items-center gap-2">
                      <span className="text-sm">{m.fullName}</span>
                      <span className="font-mono-num text-[11px] text-fg-muted">
                        ({m.username})
                      </span>
                    </span>
                    <RoleBadge role={m.role} />
                  </li>
                ))}
              </ul>
              {(membersTotal ?? members.length) > 5 ? (
                <div className="border-t border-border px-4 py-2 text-right text-xs">
                  <a
                    href={`/admin/users?organizationId=${org.id}`}
                    className="text-brand hover:underline"
                  >
                    모두 보기 ({membersTotal ?? members.length}명) →
                  </a>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 px-4 py-2">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-sm text-fg">{children}</dd>
    </div>
  );
}
