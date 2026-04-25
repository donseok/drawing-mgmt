import * as React from 'react';

import { cn } from '@/lib/cn';
import { OBJECT_STATE_LABELS } from '@drawing-mgmt/shared';
import type { ObjectStateName } from '@drawing-mgmt/shared';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

/* ─────────────────────────────────────────────────────────────────
 * StatusBadge — DESIGN §7 자체 컴포넌트.
 * - 8px dot
 * - 13px label
 * - 22px height
 * - radius full
 * - tabular-nums
 * - status-* CSS variables (lightness shifts in dark mode for contrast)
 * Korean labels from `OBJECT_STATE_LABELS` (shared constants).
 * ───────────────────────────────────────────────────────────────── */

/** Map ObjectStateName → CSS class suffix used in globals.css. */
const STATUS_CLASS: Record<ObjectStateName | 'REJECTED', string> = {
  NEW: 'new',
  CHECKED_OUT: 'checked-out',
  CHECKED_IN: 'checked-in',
  IN_APPROVAL: 'in-approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  DELETED: 'deleted',
};

/** Allow REJECTED in StatusBadge even though shared types currently
 *  omit it (DESIGN §2.1 lists 7 states; types.ts will be expanded). */
type StatusName = ObjectStateName | 'REJECTED';

/** Local label fallback for REJECTED until shared constants include it. */
const STATE_LABELS_EXTENDED: Record<StatusName, string> = {
  ...OBJECT_STATE_LABELS,
  REJECTED: '반려',
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: StatusName;
  /** Hide the dot (label-only). */
  dotOnly?: boolean;
  /** Hide the label (dot-only). */
  labelOnly?: boolean;
  /** Compact (h-5, smaller dot) for use in dense table cells. */
  size?: 'sm' | 'default';
}

export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  (
    {
      status,
      className,
      dotOnly = false,
      labelOnly = false,
      size = 'default',
      ...props
    },
    ref,
  ) => {
    const cssKey = STATUS_CLASS[status];
    const label = STATE_LABELS_EXTENDED[status];

    return (
      <span
        ref={ref}
        role="status"
        aria-label={label}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border whitespace-nowrap',
          'font-medium tabular-nums',
          size === 'sm'
            ? 'h-[18px] px-2 text-[12px]'
            : 'h-[22px] px-2.5 text-[13px]',
          // Tinted surface uses status color for both bg & fg
          `status-tint-${cssKey}`,
          'border-transparent',
          className,
        )}
        {...props}
      >
        {!dotOnly ? (
          <span
            aria-hidden="true"
            className={cn(
              'inline-block rounded-full',
              size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2',
              `status-dot-${cssKey}`,
            )}
          />
        ) : null}
        {!labelOnly ? <span className="leading-none">{label}</span> : null}
      </span>
    );
  },
);
StatusBadge.displayName = 'StatusBadge';

/* ─────────────────────────────────────────────────────────────────
 * ChatModeBadge — DESIGN §8.2, TRD §14.2.
 * - rag → "AI" (brand color)
 * - rule → "안내" (amber)
 * Includes Tooltip with full mode description.
 * ───────────────────────────────────────────────────────────────── */

export type ChatModeName = 'rag' | 'rule';

export interface ChatModeBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  mode: ChatModeName;
  /** Whether the rule mode came from auto fallback (vs. explicit admin config). */
  fallback?: boolean;
  /** Skip tooltip wrapping (e.g. when the parent already has one). */
  noTooltip?: boolean;
}

const CHAT_MODE_DESCRIPTIONS: Record<ChatModeName, { label: string; description: string }> = {
  rag: {
    label: 'AI',
    description: 'AI 모드 — Claude + 매뉴얼 RAG로 자연어 응답을 생성합니다.',
  },
  rule: {
    label: '안내',
    description:
      '안내 모드 — 외부 LLM 호출 없이 인텐트 매칭으로 동작합니다. 자연어 응답이 제한될 수 있습니다.',
  },
};

export const ChatModeBadge = React.forwardRef<HTMLSpanElement, ChatModeBadgeProps>(
  ({ mode, fallback = false, noTooltip = false, className, ...props }, ref) => {
    const { label, description } = CHAT_MODE_DESCRIPTIONS[mode];

    // rag → brand, rule(auto fallback) → amber, rule(forced) → slate
    const tone =
      mode === 'rag'
        ? 'bg-brand/10 text-brand border-brand/20'
        : fallback
          ? 'bg-warning/15 text-warning border-warning/30'
          : 'bg-bg-muted text-fg-muted border-border';

    const dotColor =
      mode === 'rag' ? 'bg-brand' : fallback ? 'bg-warning' : 'bg-fg-muted';

    const badge = (
      <span
        ref={ref}
        role="status"
        aria-label={`챗봇 모드: ${label}`}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2 h-[20px]',
          'text-[12px] font-medium leading-none whitespace-nowrap tabular-nums',
          tone,
          className,
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn('inline-block h-1.5 w-1.5 rounded-full', dotColor)}
        />
        {label}
      </span>
    );

    if (noTooltip) return badge;

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent side="bottom">{description}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  },
);
ChatModeBadge.displayName = 'ChatModeBadge';
