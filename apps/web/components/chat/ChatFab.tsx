'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';
import { ChatPanel } from './ChatPanel';
import { RobotAvatar } from './RobotAvatar';

/**
 * R36 — floating chat launcher.
 *
 * - 56×56 brand-colored disc fixed bottom-right.
 * - Hosts the panel as a sibling: when `chatOpen` flips, the panel mounts and
 *   pushes a brief `panel-enter` animation. (Mobile: full-screen sheet.)
 * - Auto-hides on the full-screen viewer (`/viewer/...`) so the canvas stays
 *   uncovered. The ⌘. shortcut still works because that path lives in the
 *   global `useKeyboardShortcuts` hook, not here.
 */
export function ChatFab() {
  const pathname = usePathname();
  const chatOpen = useUiStore((s) => s.chatOpen);
  const toggleChat = useUiStore((s) => s.toggleChat);
  const setChatOpen = useUiStore((s) => s.setChatOpen);

  // Hide on the dedicated viewer route. The shortcut still works via the
  // global handler, so power users aren't locked out.
  const onViewerRoute = React.useMemo(
    () => Boolean(pathname && pathname.startsWith('/viewer/')),
    [pathname],
  );

  if (onViewerRoute && !chatOpen) {
    // Hide both FAB + panel on viewer when nothing is open.
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={toggleChat}
        aria-label={chatOpen ? 'AI 도우미 닫기' : 'AI 도우미 열기'}
        title="AI 도우미 (Ctrl+.)"
        aria-pressed={chatOpen}
        className={cn(
          'fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full',
          'shadow-lg ring-1 ring-brand/20',
          'transition-all duration-100 ease-out',
          chatOpen
            ? 'bg-bot-primary-deep'
            : 'bg-brand hover:scale-105 hover:bg-brand-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          // Auto-fade on viewer route when panel is open (panel covers anyway)
          onViewerRoute && chatOpen && 'opacity-60',
        )}
      >
        {/* Slight upward translate so the head reads as the visual centroid. */}
        <span className="-translate-y-px">
          <RobotAvatar
            size="fab"
            variant="on-brand"
            state={chatOpen ? 'speaking' : 'idle'}
          />
        </span>
      </button>
      {chatOpen ? <ChatPanel onRequestClose={() => setChatOpen(false)} /> : null}
    </>
  );
}
