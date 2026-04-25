'use client';

import * as React from 'react';
import { Check, Clock, Minus, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  getInitials,
} from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * ApprovalLine — DESIGN §7 자체 컴포넌트 시각 사양.
 *
 * Renders horizontal step indicator:
 *   [1단계 ✓] ── [2단계 ✓] ── [3단계 ⏳ 진행중] ── [4단계 ─]
 *   김지원       박상민        최정아                   임도현
 *   4/22 09:12  4/22 14:33    —                          —
 *
 * Hover on a step shows the comment (Tooltip).
 */

export type ApprovalStepStatus =
  | 'PENDING' // 대기 (-)
  | 'IN_PROGRESS' // 진행 중 (⏳)
  | 'APPROVED' // 승인 (✓)
  | 'REJECTED' // 반려 (✕)
  | 'SKIPPED'; // 스킵 (─)

export interface ApprovalStep {
  /** 1-based step order. */
  order: number;
  /** Approver display name (also used for avatar fallback). */
  approver: string;
  /** Optional avatar URL. */
  avatarUrl?: string | null;
  /** Step status. */
  status: ApprovalStepStatus;
  /** Render-ready timestamp string when actedAt exists, e.g. "4/22 09:12". */
  actedAt?: string | null;
  /** Approver comment, shown in tooltip on hover. */
  comment?: string | null;
  /** Optional override label for the step (default: `${order}단계`). */
  label?: string;
}

export interface ApprovalLineProps extends React.HTMLAttributes<HTMLDivElement> {
  steps: ApprovalStep[];
  /** Compact horizontal layout. Default: true. Future: vertical for narrow panels. */
  orientation?: 'horizontal' | 'vertical';
}

const STATUS_META: Record<
  ApprovalStepStatus,
  { Icon: React.ComponentType<{ className?: string }>; tone: string; label: string }
> = {
  PENDING: { Icon: Minus, tone: 'border-border text-fg-subtle bg-bg', label: '대기' },
  IN_PROGRESS: {
    Icon: Clock,
    tone: 'border-status-checkedOut text-status-checkedOut bg-amber-50 dark:bg-amber-500/10',
    label: '진행중',
  },
  APPROVED: {
    Icon: Check,
    tone: 'border-status-approved text-status-approved bg-emerald-50 dark:bg-emerald-500/10',
    label: '승인',
  },
  REJECTED: {
    Icon: X,
    tone: 'border-status-rejected text-status-rejected bg-rose-50 dark:bg-rose-500/10',
    label: '반려',
  },
  SKIPPED: {
    Icon: Minus,
    tone: 'border-dashed border-border text-fg-subtle bg-bg-subtle',
    label: '생략',
  },
};

export function ApprovalLine({
  steps,
  orientation = 'horizontal',
  className,
  ...props
}: ApprovalLineProps) {
  if (steps.length === 0) {
    return (
      <div
        className={cn(
          'rounded-md border border-dashed border-border p-4 text-center text-sm text-fg-muted',
          className,
        )}
        {...props}
      >
        결재선이 지정되지 않았습니다.
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div
        role="list"
        aria-label="결재선"
        className={cn(
          orientation === 'horizontal'
            ? 'flex w-full items-start gap-0 overflow-x-auto'
            : 'flex flex-col gap-3',
          className,
        )}
        {...props}
      >
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          return (
            <React.Fragment key={`${step.order}-${step.approver}`}>
              <ApprovalStepNode step={step} />
              {!isLast ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    orientation === 'horizontal'
                      ? 'mt-5 h-px flex-1 min-w-6 bg-border'
                      : 'ml-5 h-6 w-px bg-border',
                  )}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

function ApprovalStepNode({ step }: { step: ApprovalStep }) {
  const { Icon, tone, label } = STATUS_META[step.status];
  const stepLabel = step.label ?? `${step.order}단계`;

  const card = (
    <div
      role="listitem"
      className="flex flex-col items-center gap-1.5 min-w-[88px] py-1"
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full border h-5 w-5',
            tone,
          )}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
        </span>
        <span className="text-[12px] font-medium text-fg whitespace-nowrap">
          {stepLabel}
        </span>
      </div>
      <Avatar className="h-7 w-7">
        {step.avatarUrl ? <AvatarImage src={step.avatarUrl} alt={step.approver} /> : null}
        <AvatarFallback>{getInitials(step.approver)}</AvatarFallback>
      </Avatar>
      <span className="text-[12px] text-fg whitespace-nowrap">{step.approver}</span>
      <span className="text-[11px] text-fg-subtle font-mono-num whitespace-nowrap">
        {step.actedAt ?? '—'}
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );

  if (!step.comment) return card;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help">{card}</div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="text-[12px] leading-relaxed whitespace-pre-line">{step.comment}</p>
      </TooltipContent>
    </Tooltip>
  );
}
