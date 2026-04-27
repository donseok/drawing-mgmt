'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, ClipboardCopy, Eye, EyeOff } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

import {
  passwordResetManualSchema,
  type AdminUserListItem,
  type PasswordResetManualValues,
} from './types';

/**
 * R29 §A.7 — PasswordResetDialog.
 *
 * Two modes — manual (admin types a temp password) and generate (BE creates
 * a 12-char alnum + symbol). Generate mode displays the plaintext exactly
 * once; the admin must check "전달했음" before [닫기] enables. Once closed,
 * the dialog state resets so a re-open will not show the prior plaintext.
 */

type Mode = 'manual' | 'generate';

export interface PasswordResetDialogProps {
  user: Pick<AdminUserListItem, 'id' | 'username' | 'fullName'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Manual mode submit — admin-typed password. */
  onSubmitManual: (tempPassword: string) => Promise<void>;
  /** Generate mode submit — server returns plaintext, surfaced inline. */
  onSubmitGenerate: () => Promise<{ tempPassword: string }>;
}

export function PasswordResetDialog({
  user,
  open,
  onOpenChange,
  onSubmitManual,
  onSubmitGenerate,
}: PasswordResetDialogProps): JSX.Element {
  const [mode, setMode] = React.useState<Mode>('generate');
  const [showPlain, setShowPlain] = React.useState(false);
  const [generated, setGenerated] = React.useState<string | null>(null);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  // Reset when re-opening so the previous plaintext can never leak. We also
  // reset on `user.id` change in case the dialog is kept mounted and hopped
  // between rows.
  React.useEffect(() => {
    if (!open) {
      setGenerated(null);
      setAcknowledged(false);
      setCopied(false);
      setShowPlain(false);
      setMode('generate');
      manualForm.reset({ tempPassword: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user.id]);

  const manualForm = useForm<PasswordResetManualValues>({
    resolver: zodResolver(passwordResetManualSchema),
    defaultValues: { tempPassword: '' },
  });

  const handleManual = manualForm.handleSubmit(async ({ tempPassword }) => {
    setPending(true);
    try {
      await onSubmitManual(tempPassword);
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  });

  const handleGenerate = async () => {
    setPending(true);
    try {
      const { tempPassword } = await onSubmitGenerate();
      setGenerated(tempPassword);
    } finally {
      setPending(false);
    }
  };

  const handleCopy = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers / insecure contexts: fall back to selecting the text.
      // The <output> already has `select-all`, so the admin can Ctrl+C.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>비밀번호 리셋</DialogTitle>
          <DialogDescription>
            대상: <span className="font-medium text-fg">{user.fullName}</span>
            <span className="ml-1 font-mono text-fg-muted">({user.username})</span>
          </DialogDescription>
        </DialogHeader>

        {generated ? (
          /* Result view — plaintext is shown exactly once. */
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              {user.fullName}님의 임시 비밀번호가 설정되었습니다.
            </p>
            <output
              aria-label="자동 생성된 임시 비밀번호"
              className="block select-all rounded-md border border-amber-200 bg-amber-50 px-3 py-2 font-mono text-base text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
            >
              {generated}
            </output>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                ⚠ 이 비밀번호는 다시 표시되지 않습니다. 지금 메모하거나 사용자에게 전달하세요.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    복사됨
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="h-3.5 w-3.5" />
                    복사
                  </>
                )}
              </Button>
            </div>
            <label className="flex items-start gap-2 text-sm text-fg">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                aria-label="안전한 채널로 전달했음"
                className="mt-0.5"
              />
              <span>안전한 채널(메신저·전화 등)로 사용자에게 전달했습니다.</span>
            </label>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={!acknowledged}
              >
                닫기
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* Input view — choose mode and submit. */
          <div className="space-y-3">
            <fieldset className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="radio"
                  name="reset-mode"
                  checked={mode === 'manual'}
                  onChange={() => setMode('manual')}
                  className="h-4 w-4 accent-brand"
                />
                직접 입력
              </label>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="radio"
                  name="reset-mode"
                  checked={mode === 'generate'}
                  onChange={() => setMode('generate')}
                  className="h-4 w-4 accent-brand"
                />
                자동 생성
              </label>
            </fieldset>

            {mode === 'manual' ? (
              <form onSubmit={handleManual} className="space-y-2" noValidate>
                <Label htmlFor="reset-temp" required>
                  임시 비밀번호
                </Label>
                <div className="relative">
                  <Input
                    id="reset-temp"
                    type={showPlain ? 'text' : 'password'}
                    autoComplete="off"
                    placeholder="8~64자"
                    aria-invalid={
                      !!manualForm.formState.errors.tempPassword || undefined
                    }
                    {...manualForm.register('tempPassword')}
                  />
                  <button
                    type="button"
                    aria-label={showPlain ? '비밀번호 숨기기' : '비밀번호 표시'}
                    onClick={() => setShowPlain((s) => !s)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-fg-muted hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPlain ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-fg-subtle">
                  8자 이상. 사용자에게 별도 채널로 전달하세요.
                </p>
                {manualForm.formState.errors.tempPassword && (
                  <p className="text-xs text-danger">
                    {manualForm.formState.errors.tempPassword.message}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={pending}
                  >
                    취소
                  </Button>
                  <Button type="submit" disabled={pending}>
                    {pending ? '리셋 중...' : '리셋'}
                  </Button>
                </DialogFooter>
              </form>
            ) : (
              <div className="space-y-2">
                <p className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs text-fg-muted">
                  12자 영숫자+기호 임의 비밀번호가 자동 생성되어 화면에 1회만
                  표시됩니다. 이후 다시 볼 수 없으니 반드시 안전하게 메모해
                  사용자에게 전달하세요.
                </p>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={pending}
                  >
                    취소
                  </Button>
                  <Button type="button" onClick={handleGenerate} disabled={pending}>
                    {pending ? '생성 중...' : '리셋'}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
