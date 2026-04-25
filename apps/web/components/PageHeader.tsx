import * as React from 'react';

import { cn } from '@/lib/cn';

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Page title. */
  title: React.ReactNode;
  /** Optional sub-title or contextual line below the title. */
  description?: React.ReactNode;
  /** Action slot (right) — typically buttons. */
  actions?: React.ReactNode;
  /** Optional breadcrumb / back link rendered above the title. */
  eyebrow?: React.ReactNode;
}

/**
 * PageHeader — generic page-level header (DESIGN §6 various).
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ eyebrow                                                  │
 *   │ Title (h1)                            [actions]          │
 *   │ description                                              │
 *   └─────────────────────────────────────────────────────────┘
 */
export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ className, title, description, actions, eyebrow, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-2 pb-4 border-b border-border', className)}
      {...props}
    >
      {eyebrow ? (
        <div className="text-sm text-fg-muted">{eyebrow}</div>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold leading-tight text-fg">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-fg-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  ),
);
PageHeader.displayName = 'PageHeader';
