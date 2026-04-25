'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * FilterChip — DESIGN §6.3, §7.
 *
 * Dismissible chip used in the search Toolbar to display applied filters.
 * Click X (or press Backspace while focused) to remove.
 *
 * Composition:
 *   <FilterChip label="상태" value="승인됨" onRemove={() => clear('state')} />
 *   <FilterChip label="등록일" value="2026-01 ~ 2026-04" onRemove={...} />
 */
export interface FilterChipProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Filter key/label, e.g. "상태", "자료유형". Optional. */
  label?: React.ReactNode;
  /** Selected value preview. */
  value: React.ReactNode;
  /** Removal handler. */
  onRemove?: () => void;
  /** Hide the X button (read-only chip). */
  readOnly?: boolean;
  /** Visual emphasis. */
  variant?: 'default' | 'outline';
}

export const FilterChip = React.forwardRef<HTMLDivElement, FilterChipProps>(
  (
    {
      label,
      value,
      onRemove,
      readOnly = false,
      variant = 'default',
      className,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented || readOnly || !onRemove) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        onRemove();
      }
    };

    return (
      <div
        ref={ref}
        role="group"
        tabIndex={readOnly ? undefined : 0}
        onKeyDown={handleKeyDown}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md border px-2',
          'text-xs leading-none whitespace-nowrap',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
          variant === 'default'
            ? 'bg-bg-muted border-transparent text-fg'
            : 'bg-bg border-border text-fg',
          className,
        )}
        {...props}
      >
        {label ? (
          <>
            <span className="font-medium text-fg-muted">{label}</span>
            <span aria-hidden="true" className="text-fg-subtle">
              :
            </span>
          </>
        ) : null}
        <span className="font-medium text-fg">{value}</span>
        {!readOnly && onRemove ? (
          <button
            type="button"
            aria-label={`${label ?? '필터'} 제거`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className={cn(
              'ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded',
              'text-fg-muted hover:text-fg hover:bg-bg-subtle',
              'focus:outline-none focus:ring-2 focus:ring-ring',
              'transition-colors',
            )}
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    );
  },
);
FilterChip.displayName = 'FilterChip';
