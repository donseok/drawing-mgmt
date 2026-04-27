'use client';

import * as React from 'react';
import {
  KeyRound,
  Lock,
  MoreVertical,
  Pencil,
  ShieldAlert,
  Trash2,
  Unlock,
  UserCog,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
// Tooltip is still used on the self-row UserCog hint (and is wrapped in
// `<TooltipProvider>` for any future Radix tooltip placements).
import { cn } from '@/lib/cn';

import type { AdminUserListItem } from './types';
import { isInactive, isLocked } from './types';
import { EmploymentBadge, RoleBadge } from './RoleBadge';

/**
 * R29 §A.4 — UserManagementTable.
 *
 * Single-column table; row actions live behind a `⋮` DropdownMenu. LOCKED
 * rows get an amber tint, deactivated rows get strikethrough/grayscale, the
 * current session's row gets a `<UserCog>` icon prefix on the username.
 *
 * Permission shape (FE side; BE is the truth):
 *   - The session's own row → 비활성화 永구 disabled.
 *   - SUPER_ADMIN target row in an ADMIN session → 수정/비활성화/리셋 모두
 *     disabled with a tooltip ("SUPER_ADMIN은 다른 SUPER_ADMIN만 수정할 수
 *     있습니다.").
 */

export interface UserManagementTableProps {
  rows: AdminUserListItem[];
  currentSelfId: string;
  currentSelfRole: AdminUserListItem['role'];
  loading?: boolean;
  onEdit: (user: AdminUserListItem) => void;
  onUnlock: (user: AdminUserListItem) => void;
  onResetPassword: (user: AdminUserListItem) => void;
  onDeactivate: (user: AdminUserListItem) => void;
}

export function UserManagementTable({
  rows,
  currentSelfId,
  currentSelfRole,
  loading,
  onEdit,
  onUnlock,
  onResetPassword,
  onDeactivate,
}: UserManagementTableProps): JSX.Element {
  return (
    <TooltipProvider>
      <div className="app-panel overflow-hidden">
        <table className="app-table w-full">
          <thead>
            <tr>
              <th scope="col" className="w-[120px]">
                사용자명
              </th>
              <th scope="col" className="w-[120px]">
                이름
              </th>
              <th scope="col" className="min-w-[200px]">
                이메일
              </th>
              <th scope="col" className="w-[140px]">
                조직
              </th>
              <th scope="col" className="w-[110px]">
                역할
              </th>
              <th scope="col" className="w-[90px]">
                재직
              </th>
              <th scope="col" className="w-[60px] text-center">
                보안
              </th>
              <th scope="col" className="w-[140px]">
                잠금
              </th>
              <th scope="col" className="w-[44px] text-right" aria-label="작업" />
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
              : rows.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    currentSelfId={currentSelfId}
                    currentSelfRole={currentSelfRole}
                    onEdit={onEdit}
                    onUnlock={onUnlock}
                    onResetPassword={onResetPassword}
                    onDeactivate={onDeactivate}
                  />
                ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}

function SkeletonRow(): JSX.Element {
  return (
    <tr>
      {Array.from({ length: 9 }).map((_, i) => (
        <td key={i}>
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

interface UserRowProps {
  user: AdminUserListItem;
  currentSelfId: string;
  currentSelfRole: AdminUserListItem['role'];
  onEdit: (user: AdminUserListItem) => void;
  onUnlock: (user: AdminUserListItem) => void;
  onResetPassword: (user: AdminUserListItem) => void;
  onDeactivate: (user: AdminUserListItem) => void;
}

function UserRow({
  user,
  currentSelfId,
  currentSelfRole,
  onEdit,
  onUnlock,
  onResetPassword,
  onDeactivate,
}: UserRowProps): JSX.Element {
  const locked = isLocked(user);
  const inactive = isInactive(user);
  const isSelf = user.id === currentSelfId;
  // SUPER_ADMIN protection: an ADMIN session cannot edit/deactivate a
  // SUPER_ADMIN target. SUPER_ADMINs can edit anyone.
  const protectedTarget =
    user.role === 'SUPER_ADMIN' && currentSelfRole !== 'SUPER_ADMIN';

  const lockedUntilLabel = formatLockedUntil(user.lockedUntil);

  return (
    <tr
      className={cn(
        'group border-l-2 border-transparent',
        locked && 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/20',
        inactive && 'border-slate-300 bg-bg-subtle text-fg-subtle',
        isSelf && 'font-medium',
      )}
    >
      {/* 사용자명 */}
      <td>
        <div className="flex items-center gap-1.5">
          {isSelf ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span aria-label="본인 계정">
                  <UserCog className="h-3 w-3 shrink-0 text-brand" />
                </span>
              </TooltipTrigger>
              <TooltipContent>본인 계정</TooltipContent>
            </Tooltip>
          ) : null}
          <span
            className={cn(
              'truncate font-mono text-[12px] text-fg',
              inactive && 'line-through',
            )}
            title={user.username}
          >
            {user.username}
          </span>
        </div>
      </td>
      {/* 이름 */}
      <td>
        <span className={cn('text-sm font-medium text-fg', inactive && 'line-through')}>
          {user.fullName}
        </span>
      </td>
      {/* 이메일 */}
      <td>
        <span
          className={cn(
            'block truncate font-mono text-[12px] text-fg-muted',
            inactive && 'line-through',
          )}
          title={user.email ?? undefined}
        >
          {user.email ?? '—'}
        </span>
      </td>
      {/* 조직 */}
      <td>
        <span
          className={cn(
            'truncate text-sm text-fg-muted',
            user.role === 'PARTNER' && 'text-violet-700 dark:text-violet-300',
            inactive && 'line-through',
          )}
        >
          {user.organization?.name ?? '—'}
        </span>
      </td>
      {/* 역할 */}
      <td>
        <RoleBadge role={user.role} />
      </td>
      {/* 재직 */}
      <td>
        <EmploymentBadge employmentType={user.employmentType} inactive={inactive} />
      </td>
      {/* 보안 */}
      <td className="text-center">
        <span
          className={cn(
            'tabular-nums text-sm',
            user.securityLevel === 1 && 'font-semibold text-rose-600',
            user.securityLevel === 5 && 'text-fg-subtle',
          )}
        >
          {user.securityLevel}
        </span>
      </td>
      {/* 잠금 */}
      <td>
        {locked ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-amber-700 dark:text-amber-300">
            <Lock className="h-3 w-3" />
            잠김
            {lockedUntilLabel ? (
              <span className="font-mono-num text-[11px] text-amber-700/80">
                ({lockedUntilLabel})
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>
      {/* Actions */}
      <td className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${user.fullName} 작업`}
              className="app-icon-button h-7 w-7"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[12rem]">
            <ProtectedItem
              disabled={protectedTarget || inactive}
              tooltip={
                protectedTarget
                  ? 'SUPER_ADMIN 계정은 다른 SUPER_ADMIN만 수정할 수 있습니다.'
                  : inactive
                    ? '비활성 사용자는 수정할 수 없습니다.'
                    : undefined
              }
              onSelect={() => onEdit(user)}
              icon={<Pencil className="h-4 w-4" />}
              label="수정"
            />
            <ProtectedItem
              disabled={!locked}
              tooltip={!locked ? '잠금 상태가 아닙니다.' : undefined}
              onSelect={() => onUnlock(user)}
              icon={<Unlock className="h-4 w-4" />}
              label="잠금 해제"
            />
            <ProtectedItem
              disabled={inactive || protectedTarget}
              tooltip={
                protectedTarget
                  ? 'SUPER_ADMIN 계정의 비밀번호는 다른 SUPER_ADMIN만 변경할 수 있습니다.'
                  : inactive
                    ? '비활성 사용자는 비밀번호를 변경할 수 없습니다.'
                    : undefined
              }
              onSelect={() => onResetPassword(user)}
              icon={<KeyRound className="h-4 w-4" />}
              label="비밀번호 리셋"
            />
            <DropdownMenuSeparator />
            <ProtectedItem
              disabled={inactive || isSelf || protectedTarget}
              tooltip={
                isSelf
                  ? '본인 계정은 비활성화할 수 없습니다.'
                  : protectedTarget
                    ? 'SUPER_ADMIN 계정은 다른 SUPER_ADMIN만 비활성화할 수 있습니다.'
                    : inactive
                      ? '이미 비활성된 사용자입니다.'
                      : undefined
              }
              destructive
              onSelect={() => onDeactivate(user)}
              icon={<Trash2 className="h-4 w-4" />}
              label="비활성화"
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

interface ProtectedItemProps {
  disabled?: boolean;
  tooltip?: string;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  destructive?: boolean;
}

function ProtectedItem({
  disabled,
  tooltip,
  onSelect,
  icon,
  label,
  destructive,
}: ProtectedItemProps): JSX.Element {
  // Radix's `data-disabled` already blocks pointer; we use the native
  // `title` attribute on the disabled item so the admin sees *why* they
  // can't click. (Tooltip+DropdownMenu nesting fights Radix's focus
  // trap, so we keep this simple.)
  return (
    <DropdownMenuItem
      disabled={disabled}
      destructive={destructive}
      title={disabled ? tooltip : undefined}
      onSelect={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onSelect();
      }}
    >
      {icon}
      {label}
      {disabled ? (
        <ShieldAlert className="ml-auto h-3 w-3 text-fg-subtle" />
      ) : null}
    </DropdownMenuItem>
  );
}

/** "M/D HH:mm" or empty string. */
function formatLockedUntil(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${hh}:${mm}`;
}
