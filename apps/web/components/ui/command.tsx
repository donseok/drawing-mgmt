'use client';

import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Dialog, DialogContent } from '@/components/ui/dialog';

/**
 * Command — cmdk wrapper (DESIGN §5.1, §7).
 * Used for the global ⌘K command palette: 도면·폴더·명령 그룹.
 *
 * `<Command>` standalone for inline; `<CommandDialog>` for ⌘K modal.
 */
export const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

export interface CommandDialogProps extends React.ComponentProps<typeof Dialog> {
  /** Optional title for screen readers. */
  label?: string;
  className?: string;
  children?: React.ReactNode;
}

export const CommandDialog = ({ children, label, className, ...props }: CommandDialogProps) => (
  <Dialog {...props}>
    <DialogContent
      showCloseButton={false}
      className={cn('max-w-2xl overflow-hidden p-0', className)}
    >
      <Command
        label={label}
        className={cn(
          '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
          '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
          '[&_[cmdk-group-heading]]:uppercase',
          '[&_[cmdk-group-heading]]:text-fg-subtle',
          '[&_[cmdk-group]]:px-1.5 [&_[cmdk-group]]:py-1',
          '[&_[cmdk-input-wrapper]_svg]:h-4 [&_[cmdk-input-wrapper]_svg]:w-4',
          '[&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2 [&_[cmdk-item]]:text-sm',
          '[&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4',
        )}
      >
        {children}
      </Command>
    </DialogContent>
  </Dialog>
);

export const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div
    className="flex items-center border-b border-border px-3"
    cmdk-input-wrapper=""
  >
    <Search className="mr-2 h-4 w-4 shrink-0 text-fg-muted" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'flex h-11 w-full bg-transparent py-3 text-sm text-fg outline-none',
        'placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

export const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('max-h-[400px] overflow-y-auto overflow-x-hidden', className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

export const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-center text-sm text-fg-muted"
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

export const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn('overflow-hidden p-1 text-fg', className)}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

export const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 h-px bg-border', className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

export const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
      'aria-selected:bg-bg-muted aria-selected:text-fg',
      'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
      "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

export const CommandShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      'ml-auto text-xs text-fg-subtle font-mono-num',
      className,
    )}
    {...props}
  />
);
CommandShortcut.displayName = 'CommandShortcut';
