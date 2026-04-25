'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/cn';

const labelVariants = cva(
  'text-sm font-medium leading-none text-fg peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
);

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement>,
    VariantProps<typeof labelVariants> {
  /** Mark the field as required. Adds a red asterisk. */
  required?: boolean;
}

/**
 * Label — DESIGN §7. Pairs with Input/Select/Textarea via `htmlFor`.
 * Plain `<label>` (no Radix dep). Uses `peer-*` so adjacent
 * `peer` inputs propagate disabled state.
 */
export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label ref={ref} className={cn(labelVariants(), className)} {...props}>
      {children}
      {required ? (
        <span aria-hidden="true" className="ml-0.5 text-danger">
          *
        </span>
      ) : null}
    </label>
  ),
);
Label.displayName = 'Label';
