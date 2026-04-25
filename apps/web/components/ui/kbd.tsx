import * as React from 'react';

import { cn } from '@/lib/cn';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** Children = the key glyph(s), e.g. ⌘K, Esc, Enter. */
  children: React.ReactNode;
}

/**
 * Kbd — keyboard shortcut chip (DESIGN §5.1, §6.3).
 * Used in: header search hint, command palette items, tooltip footers.
 *
 * Renders semantic `<kbd>` with the `.kbd` utility from globals.css.
 *
 * @example
 *   <Kbd>⌘K</Kbd>
 *   <span>도면번호 검색 <Kbd>/</Kbd></span>
 */
export const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, children, ...props }, ref) => (
    <kbd ref={ref} className={cn('kbd', className)} {...props}>
      {children}
    </kbd>
  ),
);
Kbd.displayName = 'Kbd';
