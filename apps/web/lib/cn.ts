import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names with conflict-resolution.
 *
 * Wraps `clsx` (conditional concatenation) with `tailwind-merge`
 * (deduplication of conflicting Tailwind classes — e.g. `p-2 p-4` → `p-4`).
 *
 * Used everywhere we accept a `className` prop on a component.
 *
 * @example
 *   <div className={cn('p-2 text-sm', isActive && 'bg-bg-muted', className)} />
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
