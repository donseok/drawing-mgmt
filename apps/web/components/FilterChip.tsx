'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * FilterChip — DESIGN §6.3, §7.
 *
 * Dismissible chip used in the search Toolbar to display applied filters.
 *
 * Accessibility (BUG-023):
 *   - Outer wrapper is a semantic <span role="group"> with an aria-label
 *     describing the filter (label + value).
 *   - The "label" area is a real <button type="button"> so it is reachable
 *     via Tab and activates `onActivate` (used by the parent to reopen
 *     the filter popover).
 *   - The remove "X" is a separate <button type="button"> sibling — never
 *     nested inside the activate button (invalid HTML). Both buttons live
 *     side-by-side inside the group wrapper.
 *   - Backspace/Delete on either button removes the chip.
 *
 * Composition:
 *   <FilterChip label="상태" value="승인됨" onRemove={() => clear('state')} />
 *   <FilterChip label="등록일" value="2026-01 ~ 2026-04" onRemove={...} />
 */
export interface FilterChipProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'onClick'> {
  /** Filter key/label, e.g. "상태", "자료유형". Optional. */
  label?: React.ReactNode;
  /** Selected value preview. */
  value: React.ReactNode;
  /** Removal handler. */
  onRemove?: () => void;
  /** Activation handler — called when the user clicks/Enter/Space on the chip body
   *  (used by the parent to reopen the filter popover). */
  onActivate?: () => void;
  /** Hide the X button (read-only chip). */
  readOnly?: boolean;
  /** Visual emphasis. */
  variant?: 'default' | 'outline';
}

/** Build a screen-reader label like "필터: 상태 = 승인됨, 클릭하여 변경". */
function buildAriaLabel(label: React.ReactNode, value: React.ReactNode, interactive: boolean) {
  const labelStr = typeof label === 'string' || typeof label === 'number' ? String(label) : '';
  const valueStr = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const head = labelStr ? `필터: ${labelStr} = ${valueStr}` : `필터: ${valueStr}`;
  return interactive ? `${head}, 클릭하여 변경` : head;
}

export const FilterChip = React.forwardRef<HTMLSpanElement, FilterChipProps>(
  (
    {
      label,
      value,
      onRemove,
      onActivate,
      readOnly = false,
      variant = 'default',
      className,
      ...props
    },
    ref,
  ) => {
    const interactive = !!onActivate;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (readOnly || !onRemove) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        onRemove();
      }
    };

    const labelStr = typeof label === 'string' ? label : '필터';
    const groupAriaLabel = buildAriaLabel(label, value, interactive);

    return (
      <span
        ref={ref}
        role="group"
        aria-label={groupAriaLabel}
        className={cn(
          'inline-flex h-7 items-center rounded-md border',
          'text-xs leading-none whitespace-nowrap',
          variant === 'default'
            ? 'bg-bg-muted border-transparent text-fg'
            : 'bg-bg border-border text-fg',
          // Group focus-within ring so the chip "feels" focusable as one unit
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
          className,
        )}
        {...props}
      >
        <button
          type="button"
          onClick={onActivate}
          onKeyDown={handleKeyDown}
          aria-label={groupAriaLabel}
          className={cn(
            'inline-flex h-full items-center gap-1.5 rounded-md px-2',
            'focus:outline-none',
            interactive ? 'cursor-pointer' : 'cursor-default',
          )}
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
        </button>
        {!readOnly && onRemove ? (
          <button
            type="button"
            aria-label={`${labelStr} 필터 제거`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={handleKeyDown}
            className={cn(
              'mr-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded',
              'text-fg-muted hover:text-fg hover:bg-bg-subtle',
              'focus:outline-none',
              'transition-colors',
            )}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}
      </span>
    );
  },
);
FilterChip.displayName = 'FilterChip';
