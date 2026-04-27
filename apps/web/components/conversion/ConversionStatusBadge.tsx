'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * ConversionStatusBadge — DESIGN spec r28 §B.9 / §C.3.
 *
 * Pill badge with a leading 6-px dot whose color encodes the conversion job
 * lifecycle. Distinct from the object StatusBadge family because the dot
 * meanings (PENDING/PROCESSING/DONE/FAILED) belong to a different domain
 * (BullMQ job state, not document control state).
 *
 * Color + dot + Korean label = both color-blind and screen-reader friendly.
 */

export type ConversionJobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface ConversionStatusBadgeProps {
  status: ConversionJobStatus;
  /** Show a spinning Loader2 inside the pill. Default true for PROCESSING. */
  showSpinner?: boolean;
  /** sm = 11px, md = 12px (default). */
  size?: 'sm' | 'md';
  className?: string;
}

interface StatusVisual {
  /** Korean label (always rendered for SR + color-blind). */
  label: string;
  /** Tailwind classes for the pill background + foreground (light + dark). */
  pill: string;
  /** Tailwind classes for the dot (6 px). */
  dot: string;
  /** Whether the dot pulses by default. */
  pulse: boolean;
}

const STATUS_VISUAL: Record<ConversionJobStatus, StatusVisual> = {
  PENDING: {
    label: '대기',
    pill: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
    dot: 'bg-slate-400',
    pulse: false,
  },
  PROCESSING: {
    label: '처리 중',
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

export function ConversionStatusBadge({
  status,
  showSpinner,
  size = 'md',
  className,
}: ConversionStatusBadgeProps): JSX.Element {
  const v = STATUS_VISUAL[status];
  // Spinner default = PROCESSING only; callers can force on/off explicitly.
  const renderSpinner = showSpinner ?? status === 'PROCESSING';
  return (
    <span
      role="status"
      aria-label={`변환 상태: ${v.label}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium leading-none',
        size === 'sm' ? 'text-[11px]' : 'text-[12px]',
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
      {renderSpinner ? (
        <Loader2
          aria-hidden="true"
          className={cn('animate-spin', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')}
          strokeWidth={2.25}
        />
      ) : null}
    </span>
  );
}
