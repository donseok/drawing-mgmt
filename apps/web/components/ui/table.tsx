import * as React from 'react';

import { cn } from '@/lib/cn';

/**
 * Table — semantic table primitives (DESIGN §6.3, §7).
 * These are presentation-only; combine with TanStack Table for sort/filter/virtualize.
 *
 * Pattern (from drawing search list):
 *   <Table>
 *     <TableHeader>
 *       <TableRow>
 *         <TableHead className="w-8"><Checkbox /></TableHead>
 *         <TableHead>도면번호</TableHead>
 *         …
 *       </TableRow>
 *     </TableHeader>
 *     <TableBody>
 *       <TableRow data-selected={selected}>…</TableRow>
 *     </TableBody>
 *   </Table>
 */
export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn('w-full caption-bottom text-sm', className)}
      {...props}
    />
  </div>
));
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'sticky top-0 z-10 bg-bg-subtle [&_tr]:border-b [&_tr]:border-border',
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t border-border bg-bg-subtle font-medium [&>tr]:last:border-b-0',
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'group/row relative border-b border-border transition-colors',
      'hover:bg-bg-subtle',
      // selected row left brand bar (DESIGN §6.3 row hover)
      'data-[state=selected]:bg-bg-muted',
      'data-[state=selected]:before:absolute data-[state=selected]:before:inset-y-0',
      'data-[state=selected]:before:left-0 data-[state=selected]:before:w-1',
      'data-[state=selected]:before:bg-brand',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-9 px-2.5 text-left align-middle text-xs font-medium uppercase tracking-wide text-fg-muted',
      '[&:has([role=checkbox])]:pr-0',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'px-2.5 py-2 align-middle text-sm text-fg [&:has([role=checkbox])]:pr-0',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn('mt-2 text-sm text-fg-muted', className)}
    {...props}
  />
));
TableCaption.displayName = 'TableCaption';
