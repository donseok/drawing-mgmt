'use client';

import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
} from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';
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
  const setWidth = useUiStore((s) => s.setSidebarWidth);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const setOpen = useUiStore((s) => s.setSidebarOpen);

  // BUG-04 — auto-collapse on small screens. The strip-rail (32 px) lets the
  // user re-open via tap; without this, a 288 px sidebar swallows ~74% of a
  // 390 px viewport and the main content becomes unreadable.
  const isNarrow = useMediaQuery('(max-width: 767px)');
  useEffect(() => {
    if (isNarrow && open) setOpen(false);
    // We deliberately do NOT auto-open when isNarrow flips back to false —
    // the user's last manual choice should win on resize.
  }, [isNarrow, open, setOpen]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;

      const onMove = (moveEvent: PointerEvent) => {
        setWidth(startWidth + moveEvent.clientX - startX);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [setWidth, width],
  );

  if (!open) {
    return (
      <aside
        aria-label={title ?? '보조 사이드바'}
        className="flex h-full w-8 shrink-0 items-start justify-center border-r border-border bg-bg/80"
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
        'relative flex h-full shrink-0 flex-col border-r border-border bg-bg/80 backdrop-blur',
        className,
      )}
    >
      {(title || toolbar) && (
        <div className="flex h-10 items-center gap-2 border-b border-border px-3">
          {title && <h2 className="app-kicker flex-1 truncate">{title}</h2>}
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
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="사이드바 너비 조절"
        title="사이드바 너비 조절"
        onPointerDown={startResize}
        className="absolute inset-y-0 -right-1 w-2 cursor-col-resize"
      >
        <span className="block h-full w-px translate-x-1 bg-transparent transition-colors hover:bg-brand/50" />
      </div>
    </aside>
  );
}
