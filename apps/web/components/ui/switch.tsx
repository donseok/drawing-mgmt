'use client';

import * as React from 'react';

import { cn } from '@/lib/cn';

/**
 * Switch — minimal toggle (R35).
 *
 * shadcn/ui's Switch is a thin wrapper over `@radix-ui/react-switch` which is
 * not installed in this project, so we roll our own using a native `<button
 * role="switch">`. The visual is the standard pill: track + thumb. The thumb
 * slides via CSS transforms keyed off `data-state`.
 *
 * - Accessible: `role="switch"` + `aria-checked` + keyboard activation comes
 *   for free from `<button>` (Space/Enter both fire onClick).
 * - Controlled-only: `checked` + `onCheckedChange` (matches Radix Switch API
 *   so a future swap is mechanical).
 * - Disabled state suppresses interaction and dims visuals.
 */
export interface SwitchProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'onChange' | 'value' | 'type'
  > {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled, className, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        data-state={checked ? 'checked' : 'unchecked'}
        disabled={disabled}
        onClick={(e) => {
          if (disabled) return;
          rest.onClick?.(e);
          if (e.defaultPrevented) return;
          onCheckedChange(!checked);
        }}
        className={cn(
          'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-brand' : 'bg-bg-muted',
          className,
        )}
        {...rest}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
    );
  },
);
Switch.displayName = 'Switch';
