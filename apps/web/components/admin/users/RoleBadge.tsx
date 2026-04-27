import * as React from 'react';
import { ShieldAlert, ShieldCheck, UsersRound } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { UserRole } from './types';

/**
 * R29 §A.4.4 — Role visual. inline-flex pill: icon + Korean label.
 * Color tokens picked per role with dark-mode tints (`*-950/30` + `*-300`).
 */
interface RoleBadgeProps {
  role: UserRole;
  className?: string;
}

const ROLE_META: Record<
  UserRole,
  {
    label: string;
    bg: string;
    fg: string;
    Icon?: React.ComponentType<{ className?: string }>;
  }
> = {
  SUPER_ADMIN: {
    label: '슈퍼관리자',
    bg: 'bg-rose-50 dark:bg-rose-950/30',
    fg: 'text-rose-700 dark:text-rose-300',
    Icon: ShieldAlert,
  },
  ADMIN: {
    label: '관리자',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    fg: 'text-amber-700 dark:text-amber-300',
    Icon: ShieldCheck,
  },
  USER: {
    label: '사용자',
    bg: 'bg-bg-subtle',
    fg: 'text-fg-muted',
  },
  PARTNER: {
    label: '협력업체',
    bg: 'bg-violet-50 dark:bg-violet-950/30',
    fg: 'text-violet-700 dark:text-violet-300',
    Icon: UsersRound,
  },
};

export function RoleBadge({ role, className }: RoleBadgeProps): JSX.Element {
  const meta = ROLE_META[role];
  const { Icon } = meta;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        meta.bg,
        meta.fg,
        className,
      )}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {meta.label}
    </span>
  );
}

const EMPLOYMENT_LABEL: Record<string, { label: string; cls: string }> = {
  ACTIVE: {
    label: '재직',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  },
  RETIRED: {
    label: '퇴직',
    cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  PARTNER: {
    label: '협력',
    cls: 'bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300',
  },
};

interface EmploymentBadgeProps {
  employmentType: string;
  inactive?: boolean;
  className?: string;
}

export function EmploymentBadge({
  employmentType,
  inactive,
  className,
}: EmploymentBadgeProps): JSX.Element {
  if (inactive) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500',
          'line-through',
          'dark:bg-slate-800 dark:text-slate-400',
          className,
        )}
      >
        비활성
      </span>
    );
  }
  const meta =
    EMPLOYMENT_LABEL[employmentType] ?? {
      label: employmentType,
      cls: 'bg-bg-subtle text-fg-muted',
    };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        meta.cls,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
