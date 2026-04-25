'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/cn';

/**
 * Button — DESIGN §7 컴포넌트 카탈로그.
 * variants: default | secondary | ghost | destructive | outline | link
 * sizes: sm | default | lg | icon
 *
 * Border-first, dense, engineering-tone (DESIGN §2.3).
 */
export const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md text-sm font-medium leading-none',
    'transition-colors duration-100 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    'disabled:pointer-events-none disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        default:
          'bg-brand text-brand-foreground hover:bg-brand-600 active:bg-brand-700',
        secondary:
          'bg-bg-muted text-fg border border-border hover:bg-bg-subtle hover:border-border-strong',
        ghost: 'text-fg hover:bg-bg-muted',
        destructive:
          'bg-danger text-white hover:bg-danger/90 active:bg-danger/80',
        outline:
          'border border-border bg-transparent text-fg hover:bg-bg-muted hover:border-border-strong',
        link:
          'text-brand underline-offset-4 hover:underline px-0 h-auto py-0',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        default: 'h-9 px-3.5',
        lg: 'h-10 px-5 text-sm',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child as the trigger element (Radix Slot). */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
