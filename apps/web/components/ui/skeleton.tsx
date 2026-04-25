import * as React from 'react';

import { cn } from '@/lib/cn';

/**
 * Skeleton — DESIGN §10.2 (loading patterns).
 * Use to preserve table-row / card geometry during async loads.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-bg-muted', className)}
      {...props}
    />
  );
}
