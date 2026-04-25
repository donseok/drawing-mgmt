'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';

/**
 * PopoverPanel — Light wrapper around `@radix-ui/react-popover`
 * (via the existing `Popover*` primitives in `./popover.tsx`).
 *
 * Use this when you want a floating panel attached to a trigger
 * (filter pickers, mini menus, notification dropdowns, etc.).
 * For full-page modals use `<Modal>`. For action menus use `<Dropdown>`.
 *
 * Width is intentionally NOT preset — pass `className` (e.g. `w-80`)
 * to size the panel. Padding defaults to `p-0` so embedded headers/lists
 * can flow edge-to-edge; add `p-4` etc. via `className` if you want padding.
 *
 * @example
 *   <PopoverPanel
 *     trigger={<Button>필터</Button>}
 *     align="start"
 *     className="w-80 p-4"
 *   >
 *     <FilterForm />
 *   </PopoverPanel>
 */
export interface PopoverPanelProps {
  /** Element that opens the panel when clicked. */
  trigger: React.ReactNode;
  /** Panel content. */
  children: React.ReactNode;
  /** Horizontal alignment relative to the trigger. Default `end`. */
  align?: 'start' | 'center' | 'end';
  /** Side of the trigger to render on. Default `bottom`. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Optional override for size/padding/etc. Replaces default `w-72 p-4`. */
  className?: string;
  /** Optional controlled open state. Omit for uncontrolled. */
  open?: boolean;
  /** Called when Radix wants to change the open state. */
  onOpenChange?: (open: boolean) => void;
}

export function PopoverPanel({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  className,
  open,
  onOpenChange,
}: PopoverPanelProps): JSX.Element {
  return (
    <Popover
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        // PopoverContent's default class includes `w-72 p-4` — strip those
        // when the consumer passes a className that controls width/padding.
        className={cn(
          // sensible defaults; consumer may override via className
          className ?? 'w-72',
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

// Re-export close so consumers can build "close on action" buttons inside.
export const PopoverPanelClose = PopoverPrimitive.Close;
