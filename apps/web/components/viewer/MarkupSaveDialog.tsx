'use client';

/**
 * MarkupSaveDialog — R-MARKUP (백로그 V-6).
 *
 * Captures the current viewer measurements as a named, optionally-shared
 * markup. The caller (ViewerSidebar's MeasurementsTab) owns the mutation:
 * this component just collects { name, isShared } and resolves the user's
 * intent. Persistence happens in `onSave`, which is async — we surface its
 * pending state and any error so the user can adjust + retry without losing
 * the input.
 *
 * Shape:
 *   - 이름 input (≤ 200, required)
 *   - "팀과 공유" 토글 (default false)
 *   - 측정 N건 미리보기 메시지
 *
 * The "share" toggle has an inline reminder that explains the visibility
 * rule. We don't gate `onSave` on a separate confirm — the toggle copy +
 * the explicit click is sufficient affirmative consent for this round
 * (contract §11 risk note).
 */

import * as React from 'react';
import { Save } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';

const NAME_MAX = 200;

export interface MarkupSaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Persist the markup. Resolves on success; throw on failure. */
  onSave: (name: string, isShared: boolean) => Promise<void>;
  /** Pre-fill the name input (e.g. when editing an existing markup later). */
  defaultName?: string;
  /** Number of measurements that will be captured. Display-only. */
  measurementCount: number;
}

export function MarkupSaveDialog({
  open,
  onOpenChange,
  onSave,
  defaultName,
  measurementCount,
}: MarkupSaveDialogProps) {
  const [name, setName] = React.useState(defaultName ?? '');
  const [isShared, setIsShared] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Reset form whenever the dialog re-opens. We intentionally re-seed `name`
  // from `defaultName` each open so the parent can suggest a new value
  // (e.g. "내 측정 — 2026-04-29").
  React.useEffect(() => {
    if (open) {
      setName(defaultName ?? '');
      setIsShared(false);
      setSubmitting(false);
      setErrorMessage(null);
    }
  }, [open, defaultName]);

  const trimmed = name.trim();
  const tooLong = trimmed.length > NAME_MAX;
  const empty = trimmed.length === 0;
  const noMeasurements = measurementCount <= 0;
  const submitDisabled =
    submitting || empty || tooLong || noMeasurements;

  const handleSave = React.useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (submitDisabled) return;
      setSubmitting(true);
      setErrorMessage(null);
      try {
        await onSave(trimmed, isShared);
        // Parent closes the dialog on success; we still flip submitting back
        // in case the parent decides not to (defensive).
        setSubmitting(false);
      } catch (err) {
        setSubmitting(false);
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '마크업 저장에 실패했습니다';
        setErrorMessage(msg);
      }
    },
    [submitDisabled, onSave, trimmed, isShared],
  );

  return (
    <Dialog open={open} onOpenChange={(v) => (submitting ? null : onOpenChange(v))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>마크업 저장</DialogTitle>
          <DialogDescription>
            현재 측정한 내용을 이 첨부에 저장합니다. 다른 세션에서 다시
            불러올 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="markup-name" required>
              이름
            </Label>
            <Input
              id="markup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 1F 평면도 비교"
              maxLength={NAME_MAX + 10 /* allow over-typing so we can warn */}
              disabled={submitting}
              autoFocus
              aria-invalid={tooLong || (empty && name.length > 0)}
            />
            <div className="flex items-start justify-between gap-2 text-[11px]">
              {tooLong ? (
                <span className="text-danger">
                  이름은 {NAME_MAX}자 이하여야 합니다.
                </span>
              ) : (
                <span className="text-fg-subtle">
                  최대 {NAME_MAX}자
                </span>
              )}
              <span
                className={cn(
                  'shrink-0 font-mono',
                  tooLong ? 'text-danger' : 'text-fg-subtle',
                )}
              >
                {trimmed.length}/{NAME_MAX}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="markup-share" className="cursor-pointer">
                팀과 공유
              </Label>
              <Switch
                id="markup-share"
                checked={isShared}
                onCheckedChange={setIsShared}
                disabled={submitting}
                aria-label="팀과 공유"
              />
            </div>
            <p className="text-[11px] text-fg-muted">
              {isShared
                ? '이 첨부에 권한이 있는 모두가 이 마크업을 볼 수 있습니다.'
                : '나만 볼 수 있습니다. 언제든 공유로 전환할 수 있습니다.'}
            </p>
          </div>

          <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs">
            {noMeasurements ? (
              <p className="text-danger">
                저장할 측정이 없습니다. 먼저 측정을 한 건 이상 추가해주세요.
              </p>
            ) : (
              <p className="text-fg-muted">
                측정 <span className="font-medium text-fg">{measurementCount}건</span>
                이 함께 저장됩니다.
              </p>
            )}
          </div>

          {errorMessage ? (
            <p className="text-xs text-danger" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="app-action-button h-9"
            >
              닫기
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="app-action-button-primary h-9 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {submitting ? '저장 중…' : '저장'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
