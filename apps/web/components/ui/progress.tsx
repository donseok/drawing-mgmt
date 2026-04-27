'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Progress — minimal progress bar shared by R31 PrintDialog +
 * AttachmentUploadDialog (design_spec §E + §C.1).
 *
 * Indeterminate mode (no `value` prop or `value === undefined`) renders a
 * sliding stripe so the user still sees forward motion when the BE doesn't
 * report % progress (e.g. PrintJob status without `progress` field — see
 * api_contract §3.3 TBD-T1).
 */

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0 – 100. Pass `undefined` (or omit) to render indeterminate. */
  value?: number;
  /** Extra `aria-valuetext` for assistive tech (e.g. "71/152 MB, ~45초"). */
  ariaValueText?: string;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ value, ariaValueText, className, ...rest }, ref) => {
    const indeterminate = value === undefined || Number.isNaN(value);
    const pct = indeterminate
      ? undefined
      : Math.max(0, Math.min(100, Math.round(value)));

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={ariaValueText}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full bg-bg-muted',
          className,
        )}
        {...rest}
      >
        {indeterminate ? (
          <div
            className={cn(
              'absolute inset-y-0 left-0 w-1/3 rounded-full bg-brand',
              'motion-safe:animate-[progress-indeterminate_1.4s_ease-in-out_infinite]',
            )}
          />
        ) : (
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    );
  },
);
Progress.displayName = 'Progress';
