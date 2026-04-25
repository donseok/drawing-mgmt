'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

/**
 * Toaster — Sonner wrapper (DESIGN §9.2).
 *
 * Position: top-right.
 * Auto-dismiss: 4s default, 6s for warning, persist for error (per DESIGN.md).
 *
 * Mount once in the root layout. Theme follows next-themes.
 */
export type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

export function Toaster({ ...props }: ToasterProps) {
  const { theme = 'system' } = useTheme();

  return (
    <SonnerToaster
      theme={theme as ToasterProps['theme']}
      position="top-right"
      closeButton
      richColors={false}
      duration={4000}
      visibleToasts={5}
      gap={8}
      offset="16px"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:rounded-md group-[.toaster]:elevation-popover group-[.toaster]:p-3 group-[.toaster]:text-sm',
          title: 'text-sm font-medium text-fg',
          description: 'text-xs text-fg-muted',
          actionButton:
            'group-[.toast]:bg-brand group-[.toast]:text-brand-foreground group-[.toast]:rounded group-[.toast]:px-2 group-[.toast]:py-1 group-[.toast]:text-xs',
          cancelButton:
            'group-[.toast]:bg-bg-muted group-[.toast]:text-fg group-[.toast]:rounded group-[.toast]:px-2 group-[.toast]:py-1 group-[.toast]:text-xs',
          closeButton:
            'group-[.toast]:bg-transparent group-[.toast]:text-fg-muted group-[.toast]:border-0 hover:group-[.toast]:text-fg',
          success: 'group-[.toaster]:!border-l-4 group-[.toaster]:!border-l-success',
          info: 'group-[.toaster]:!border-l-4 group-[.toaster]:!border-l-info',
          warning: 'group-[.toaster]:!border-l-4 group-[.toaster]:!border-l-warning',
          error: 'group-[.toaster]:!border-l-4 group-[.toaster]:!border-l-danger',
        },
      }}
      {...props}
    />
  );
}

/**
 * Re-export sonner's `toast()` directly. Wrap callers can also use specific helpers.
 *
 * @example
 *   toast.success('체크인 완료');
 *   toast.error('업로드 실패', { description: '네트워크 연결을 확인하세요.' });
 *   toast.warning('미저장 변경 사항', { duration: 6000 });
 */
export const toast = sonnerToast;
