'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Inbox,
  Clock,
  Star,
  Keyboard,
  HelpCircle,
  Hash,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';
import type { QuickAction } from '@/lib/chat-types';

/**
 * Mapping from BE `id` -> icon. Falls back to <Sparkles> for unknown.
 * Keeping this in the FE (not the BE response) so we never round-trip
 * Lucide names through JSON.
 */
const ICON_BY_ID: Record<string, LucideIcon> = {
  'open-search': Search,
  'open-approval-inbox': Inbox,
  'recent-activity': Clock,
  'my-favorites': Star,
  shortcuts: Keyboard,
  help: HelpCircle,
  'find-by-number': Hash,
};

interface QuickActionsRowProps {
  actions: QuickAction[];
  /** Layout: scrolling row above composer, vs. wrapping grid in empty-state. */
  layout?: 'row' | 'grid';
  /** Loading skeleton when actions are still being fetched. */
  loading?: boolean;
  /** Called by `prompt` kind — the panel pipes the text into the composer. */
  onPrompt: (text: string) => void;
  /** Called whenever the user dispatches an action; lets the panel optionally close. */
  onAfterDispatch?: () => void;
}

export function QuickActionsRow({
  actions,
  layout = 'row',
  loading,
  onPrompt,
  onAfterDispatch,
}: QuickActionsRowProps) {
  const router = useRouter();
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);

  const dispatch = React.useCallback(
    (a: QuickAction) => {
      if (a.kind === 'navigate' && a.href) {
        router.push(a.href);
        onAfterDispatch?.();
        return;
      }
      if (a.kind === 'palette') {
        // The CommandPalette doesn't yet accept a prefilled query; opening
        // it gets the user 90% of the way (R36 simplification).
        setPaletteOpen(true);
        onAfterDispatch?.();
        return;
      }
      if (a.kind === 'prompt' && a.promptText) {
        onPrompt(a.promptText);
        return;
      }
      if (a.kind === 'tool') {
        // Tools are dispatched as a synthetic user message so the BE picks up
        // the right path. The label doubles as the natural-language prompt.
        onPrompt(a.label);
        return;
      }
    },
    [router, setPaletteOpen, onPrompt, onAfterDispatch],
  );

  if (loading) {
    return (
      <div
        className={cn(
          'flex items-center gap-2',
          layout === 'row' ? 'overflow-x-auto px-3 py-2' : 'flex-wrap justify-center',
        )}
        aria-hidden
      >
        {Array.from({ length: layout === 'grid' ? 6 : 4 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-24 shrink-0 animate-pulse rounded-full bg-bg-muted"
          />
        ))}
      </div>
    );
  }

  if (!actions.length) return null;

  return (
    <div
      role="toolbar"
      aria-label="빠른 액션"
      className={cn(
        layout === 'row'
          ? 'no-scrollbar relative flex shrink-0 items-center gap-2 overflow-x-auto px-3 py-2'
          : 'flex flex-wrap justify-center gap-2',
      )}
    >
      {actions.map((a) => {
        const Icon = (a.id && ICON_BY_ID[a.id]) || Sparkles;
        return (
          <button
            key={a.id ?? a.label}
            type="button"
            onClick={() => dispatch(a)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full',
              'border border-border bg-bg-subtle px-3 text-xs font-medium text-fg',
              'transition-colors hover:border-brand hover:text-brand',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <Icon className="h-3 w-3" />
            <span>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}
