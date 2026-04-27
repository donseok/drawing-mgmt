'use client';

import * as React from 'react';
import {
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * AttachmentScanBadge — R36 V-INF-3 spec §5.1 / designer §A.
 *
 * Pill badge that mirrors {@link ConversionStatusBadge} (R28 pattern) but
 * encodes the ClamAV virus-scan lifecycle on Attachment rows. Six discrete
 * states map to color + dot + Korean label so the signal is dual-encoded for
 * color-blind and screen-reader users.
 *
 * Domain notes (api_contract.md §2):
 *   - PENDING   — row created, not yet enqueued or worker not ready
 *   - SCANNING  — worker picked up the job, clamscan in flight (pulse)
 *   - CLEAN     — clamscan exit 0, file safe
 *   - INFECTED  — clamscan exit 1; signature recorded, downloads blocked BE-side
 *   - SKIPPED   — CLAMAV_ENABLED=0 or binary missing — no signal either way
 *   - FAILED    — scan itself errored (timeout, OOM); admin retries via /admin/scans
 *
 * The component is intentionally read-only. Re-scan actions live on the admin
 * page (Phase 3) — InfoTab and search rows just surface state.
 */

export type AttachmentScanStatus =
  | 'PENDING'
  | 'SCANNING'
  | 'CLEAN'
  | 'INFECTED'
  | 'SKIPPED'
  | 'FAILED';

export interface AttachmentScanBadgeProps {
  status: AttachmentScanStatus;
  /** sm = 11px, md = 12px (default). Inline rows in InfoTab pass sm. */
  size?: 'sm' | 'md';
  /** Optional virus signature (only meaningful for INFECTED). Surfaced as
   *  `aria-label` suffix and a `title` so the user can hover the badge for the
   *  detected name without an extra tooltip dance. */
  signature?: string | null;
  className?: string;
}

interface ScanVisual {
  /** Korean label (always rendered for SR + color-blind). */
  label: string;
  /** Tailwind classes for the pill background + foreground (light + dark). */
  pill: string;
  /** Tailwind classes for the dot (6 px). */
  dot: string;
  /** Whether the dot pulses by default. */
  pulse: boolean;
  /** Optional inline lucide icon — INFECTED gets a shield, FAILED a question. */
  Icon?: LucideIcon;
}

const STATUS_VISUAL: Record<AttachmentScanStatus, ScanVisual> = {
  PENDING: {
    label: '검사 대기',
    pill: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
    dot: 'bg-slate-400',
    pulse: false,
  },
  SCANNING: {
    label: '검사 중',
    pill: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300',
    dot: 'bg-sky-500',
    pulse: true,
  },
  CLEAN: {
    label: '안전',
    pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    pulse: false,
    Icon: ShieldCheck,
  },
  INFECTED: {
    label: '감염',
    pill: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
    dot: 'bg-rose-500',
    pulse: false,
    Icon: ShieldAlert,
  },
  SKIPPED: {
    // CLAMAV_ENABLED=0 default — keep the signal neutral so the row doesn't
    // look "bad". We render in muted gray with no dot pulse.
    label: '검사 미사용',
    pill: 'bg-bg-muted text-fg-muted dark:bg-bg-muted',
    dot: 'bg-fg-subtle',
    pulse: false,
  },
  FAILED: {
    label: '검사 실패',
    pill: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
    dot: 'bg-amber-500',
    pulse: false,
    Icon: ShieldQuestion,
  },
};

export function AttachmentScanBadge({
  status,
  size = 'md',
  signature,
  className,
}: AttachmentScanBadgeProps): JSX.Element {
  const v = STATUS_VISUAL[status];
  const Icon = v.Icon;
  const ariaSuffix =
    status === 'INFECTED' && signature ? ` (${signature})` : '';
  const titleAttr =
    status === 'INFECTED' && signature
      ? `감염 시그니처: ${signature}`
      : v.label;

  return (
    <span
      role="status"
      aria-label={`바이러스 검사: ${v.label}${ariaSuffix}`}
      title={titleAttr}
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
      {status === 'SCANNING' ? (
        <Loader2
          aria-hidden="true"
          className={cn('animate-spin', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')}
          strokeWidth={2.25}
        />
      ) : Icon ? (
        <Icon
          aria-hidden="true"
          className={cn(size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')}
          strokeWidth={2.25}
        />
      ) : null}
    </span>
  );
}
