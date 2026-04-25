'use client';

import { type ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';

interface SubSidebarProps {
  title?: string;
  children: ReactNode;
  /** optional toolbar (search, add, etc.) */
  toolbar?: ReactNode;
  /** footer pinned to bottom */
  footer?: ReactNode;
  className?: string;
}

export function SubSidebar({ title, children, toolbar, footer, className }: SubSidebarProps) {
  const open = useUiStore((s) => s.sidebarOpen);
  const width = useUiStore((s) => s.sidebarWidth);
  const toggle = useUiStore((s) => s.toggleSidebar);

  if (!open) {
    return (
      <aside
        aria-label={title ?? '보조 사이드바'}
        className="flex h-full w-8 shrink-0 items-start justify-center border-r border-border bg-bg-subtle"
      >
        <button
          type="button"
          onClick={toggle}
          aria-label="사이드바 열기"
          title="사이드바 열기 (⌘B)"
          className="mt-3 inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label={title ?? '보조 사이드바'}
      style={{ width }}
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-bg-subtle',
        className,
      )}
    >
      {(title || toolbar) && (
        <div className="flex h-10 items-center gap-2 border-b border-border px-3">
          {title && <h2 className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h2>}
          {toolbar}
          <button
            type="button"
            onClick={toggle}
            aria-label="사이드바 접기"
            title="사이드바 접기 (⌘B)"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto px-2 py-2">{children}</div>
      {footer && <div className="border-t border-border px-3 py-2 text-xs">{footer}</div>}
    </aside>
  );
}
