import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Lucide icon component (rendered at 48px, no-color, fg-subtle). */
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional CTA — typically a Button. Passed verbatim. */
  action?: React.ReactNode;
}

/**
 * EmptyState — DESIGN §10.1.
 * Engineering-tone (Lucide icon, no illustration).
 * Use for: empty search results, empty folder, no approvals, 권한 없음.
 */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon: Icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12 text-center',
        'border border-dashed border-border rounded-lg',
        className,
      )}
      {...props}
    >
      {Icon ? (
        <Icon className="h-12 w-12 text-fg-subtle" strokeWidth={1.5} aria-hidden="true" />
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description ? (
          <p className="max-w-md text-xs text-fg-muted leading-relaxed">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  ),
);
EmptyState.displayName = 'EmptyState';
