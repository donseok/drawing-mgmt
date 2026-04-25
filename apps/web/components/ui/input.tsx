'use client';

import * as React from 'react';

import { cn } from '@/lib/cn';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  /** Optional left adornment (icon, prefix label). Rendered absolutely-positioned. */
  prefix?: React.ReactNode;
  /** Optional right adornment (icon, kbd hint, clear button). */
  suffix?: React.ReactNode;
}

/**
 * Input — DESIGN §7. Supports prefix/suffix slots (DESIGN §7 row "Input/Textarea/Select").
 *
 * If `prefix` or `suffix` is provided, the wrapper auto-pads the input.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', prefix, suffix, ...props }, ref) => {
    if (prefix || suffix) {
      return (
        <div
          className={cn(
            'relative flex h-9 w-full items-center rounded-md border border-input bg-bg',
            'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0',
            'transition-colors',
          )}
        >
          {prefix ? (
            <span className="pointer-events-none flex items-center justify-center pl-2.5 text-fg-muted [&_svg]:size-4">
              {prefix}
            </span>
          ) : null}
          <input
            ref={ref}
            type={type}
            className={cn(
              'flex h-full w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle',
              'outline-none disabled:cursor-not-allowed disabled:opacity-50',
              prefix ? 'pl-2' : 'pl-3',
              suffix ? 'pr-2' : 'pr-3',
              className,
            )}
            {...props}
          />
          {suffix ? (
            <span className="flex items-center justify-center pr-2 text-fg-muted [&_svg]:size-4">
              {suffix}
            </span>
          ) : null}
        </div>
      );
    }

    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-bg px-3 py-1 text-sm text-fg',
          'placeholder:text-fg-subtle',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-colors',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
