'use client';

import * as React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Dropdown — Compact, item-array driven menu built on
 * `@radix-ui/react-dropdown-menu` (via the existing `DropdownMenu*`
 * primitives in `./dropdown-menu.tsx`).
 *
 * Pass a `trigger` element and an `items` array; this component takes
 * care of the menu shell, separators, destructive styling, and keyboard
 * shortcut hints. Focus management, roving focus, and Esc-to-close are
 * all handled by Radix.
 *
 * For more complex menus (sub-menus, checkbox/radio items, async load)
 * use the underlying `DropdownMenu*` primitives directly.
 *
 * @example
 *   <Dropdown
 *     align="end"
 *     trigger={<button className="app-icon-button"><MoreHorizontal /></button>}
 *     items={[
 *       { label: '열기',  onSelect: open },
 *       { label: '복사',  onSelect: copy, shortcut: 'Ctrl+C' },
 *       { separator: true, label: '', onSelect: () => {} },
 *       { label: '삭제',  onSelect: remove, destructive: true },
 *     ]}
 *   />
 */
export interface DropdownItem {
  /** Visible label. Ignored when `separator` is true. */
  label: string;
  /** Click/Enter handler. Ignored when `separator` is true. */
  onSelect: () => void;
  /** Optional leading icon (16px lucide icon recommended). */
  icon?: React.ReactNode;
  /** Render with destructive styling (rose/red). */
  destructive?: boolean;
  /** Trailing keyboard shortcut hint (e.g. "Ctrl+C"). */
  shortcut?: string;
  /** If true, this row renders as a divider; label/onSelect are ignored. */
  separator?: boolean;
  /** Disable this menu item. */
  disabled?: boolean;
}

export interface DropdownProps {
  /** Element rendered as the menu trigger (button, icon-button, etc.). */
  trigger: React.ReactNode;
  /** Menu items in display order. */
  items: DropdownItem[];
  /** Horizontal alignment relative to the trigger. Default `end`. */
  align?: 'start' | 'end';
  /** Optional override for menu width / extra classes. */
  className?: string;
}

export function Dropdown({
  trigger,
  items,
  align = 'end',
  className,
}: DropdownProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={className}>
        {items.map((item, idx) => {
          if (item.separator) {
            // eslint-disable-next-line react/no-array-index-key
            return <DropdownMenuSeparator key={`sep-${idx}`} />;
          }
          return (
            <DropdownMenuItem
              // eslint-disable-next-line react/no-array-index-key
              key={`${item.label}-${idx}`}
              destructive={item.destructive}
              disabled={item.disabled}
              onSelect={() => {
                // Radix auto-closes the menu after this handler runs.
                item.onSelect();
              }}
            >
              {item.icon ? <span className="text-fg-muted">{item.icon}</span> : null}
              <span className="flex-1">{item.label}</span>
              {item.shortcut ? (
                <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
