'use client';

import * as React from 'react';
import { BookOpen, Sparkles, WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export type ChatPanelMode = 'rag' | 'rule' | 'offline';

const META: Record<
  ChatPanelMode,
  {
    label: string;
    secondary: string;
    icon: React.ComponentType<{ className?: string }>;
    cls: string;
  }
> = {
  rag: {
    label: 'RAG',
    secondary: 'AI 모드',
    icon: Sparkles,
    cls: 'bg-brand/12 text-brand',
  },
  rule: {
    label: '룰 베이스',
    secondary: '간이 모드',
    icon: BookOpen,
    cls: 'bg-warning/15 text-warning',
  },
  offline: {
    label: '오프라인',
    secondary: '연결 끊김',
    icon: WifiOff,
    cls: 'bg-bg-muted text-fg-muted',
  },
};

interface Props {
  mode: ChatPanelMode;
  /** Free-form server reason — surfaces inside the tooltip. */
  reason?: string;
  className?: string;
}

/**
 * R36 — header badge that surfaces which decision tree the chat panel is
 * currently using. Color + icon + text triple-encodes meaning (§7.7 of design).
 */
export function ModeBadge({ mode, reason, className }: Props) {
  const meta = META[mode];
  const Icon = meta.icon;
  const tip = reason ?? meta.secondary;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`현재 모드: ${meta.label}`}
            className={cn(
              'inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-semibold',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              meta.cls,
              className,
            )}
          >
            <Icon className="h-3 w-3" />
            <span>{meta.label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px] text-xs">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
