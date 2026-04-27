'use client';

// R33 D-5 — pill badge for backup row status.
//
// Mirrors ConversionStatusBadge but with the backup-specific tristate
// (RUNNING / DONE / FAILED). Sky+pulse for in-flight, emerald for success,
// rose for failure. Korean labels are rendered as text so the color isn't the
// only signal (color-blind + SR access).

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { BackupStatus } from './types';

interface BackupStatusVisual {
  label: string;
  pill: string;
  dot: string;
  pulse: boolean;
}

const STATUS_VISUAL: Record<BackupStatus, BackupStatusVisual> = {
  RUNNING: {
    label: '진행 중',
    pill: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300',
    dot: 'bg-sky-500',
    pulse: true,
  },
  DONE: {
    label: '완료',
    pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    pulse: false,
  },
  FAILED: {
    label: '실패',
    pill: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
    dot: 'bg-rose-500',
    pulse: false,
  },
};

export interface BackupStatusBadgeProps {
  status: BackupStatus;
  className?: string;
}

export function BackupStatusBadge({
  status,
  className,
}: BackupStatusBadgeProps): JSX.Element {
  const v = STATUS_VISUAL[status];
  return (
    <span
      role="status"
      aria-label={`백업 상태: ${v.label}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium leading-none',
        v.pill,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
          v.dot,
          v.pulse && 'animate-pulse',
        )}
      />
      <span>{v.label}</span>
      {status === 'RUNNING' ? (
        <Loader2
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin"
          strokeWidth={2.25}
        />
      ) : null}
    </span>
  );
}
