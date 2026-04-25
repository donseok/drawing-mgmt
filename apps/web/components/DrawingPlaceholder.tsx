import * as React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';

interface DrawingPlaceholderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Grid cell size in px. Default 24. */
  gridSize?: number;
  /** Grid line color. 'viewer' = drafting canvas; 'border' = subtle. Default 'viewer'. */
  tone?: 'viewer' | 'border';
  /** Icon shown in the centered card. Default `ImageIcon`. Pass `null` to hide. */
  icon?: LucideIcon | null;
  /** Inner card size class. Default `h-16 w-16`. */
  cardClassName?: string;
}

/**
 * Engineering-grid background used wherever a real drawing thumbnail isn't
 * available yet (search preview, approval mini-preview, object detail page).
 */
export function DrawingPlaceholder({
  gridSize = 24,
  tone = 'viewer',
  icon = ImageIcon,
  cardClassName,
  className,
  ...rest
}: DrawingPlaceholderProps) {
  const color = tone === 'viewer' ? 'hsl(var(--viewer-grid))' : 'hsl(var(--border))';
  const Icon = icon;
  return (
    <div
      className={cn(
        'flex h-full w-full items-center justify-center text-fg-subtle',
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(90deg, ${color} 1px, transparent 1px), linear-gradient(0deg, ${color} 1px, transparent 1px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
      }}
      {...rest}
    >
      {Icon ? (
        <div
          className={cn(
            'flex items-center justify-center rounded-lg border border-border bg-bg/90 shadow-sm',
            cardClassName ?? 'h-16 w-16',
          )}
        >
          <Icon className="h-8 w-8" />
        </div>
      ) : null}
    </div>
  );
}
