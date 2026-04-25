import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/cn';

/**
 * Badge — DESIGN §7. Generic chip used for tags, counts, types.
 * Status-specific badges live in `<StatusBadge />` (DESIGN §7).
 */
export const badgeVariants = cva(
  cn(
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
    'text-xs font-medium leading-none',
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
  ),
  {
    variants: {
      variant: {
        default: 'border-transparent bg-brand text-brand-foreground',
        secondary: 'border-transparent bg-bg-muted text-fg',
        outline: 'border-border text-fg',
        destructive: 'border-transparent bg-danger text-white',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';
