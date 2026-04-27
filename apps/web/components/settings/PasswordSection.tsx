'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';

/**
 * PasswordSection — 비밀번호 변경.
 *
 * R39 A-4 정책:
 *   - 길이 ≥ 10자
 *   - 영문(대/소) / 숫자 / 특수 중 3종 이상 포함
 *   - 직전 2개와 다름 (서버 검증 — `WEAK_PASSWORD` / `PASSWORD_REUSED`)
 *   - 변경 시 passwordChangedAt = now() (서버)
 *
 * 클라이언트는 처음 두 가지(길이·종류)를 실시간으로 체크 + 표시.
 * "직전 2개"는 해시만 저장되므로 클라이언트가 알 수 없음 → 서버 응답
 * `PASSWORD_REUSED`로 RHF setError + toast.
 *
 * R39 A-4 만료 임박 배너:
 *   - passwordChangedAt + 83d ≤ now < + 90d 이면 "곧 만료됩니다" 노란 배너
 *   - 90d 이상이면 (BE middleware가 강제 redirect를 띄우므로) 사용자가
 *     이 페이지를 보는 일이 없지만, 안전하게 빨간 배너로 안내.
 */

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력하세요.'),
    newPassword: z
      .string()
      .min(10, '새 비밀번호는 10자 이상이어야 합니다.')
      .max(128, '비밀번호는 128자 이하여야 합니다.')
      .refine(countCharClasses, {
        message: '영문, 숫자, 특수문자 중 3종 이상을 포함해야 합니다.',
      }),
    confirmPassword: z.string().min(1, '비밀번호 확인을 입력하세요.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: '새 비밀번호가 일치하지 않습니다.',
    path: ['confirmPassword'],
  });

function countCharClasses(pw: string): boolean {
  let kinds = 0;
  if (/[a-zA-Z]/.test(pw)) kinds++;
  if (/\d/.test(pw)) kinds++;
  // 특수문자: 흔한 ASCII 기호 + 공백 제외. 너무 좁히면 한국어 키보드 사용자가
  // 입력 어려운 기호만 남으므로 ASCII 비영숫자 전반을 인정.
  if (/[^A-Za-z0-9]/.test(pw)) kinds++;
  return kinds >= 3;
}

type PasswordFormValues = z.infer<typeof passwordSchema>;

interface PasswordSectionProps {
  /** ISO timestamp from /api/v1/me. Null when the user has never changed their password. */
  passwordChangedAt: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_DAYS = 90;
const WARN_DAYS = 7; // 90 - 83 — start warning 7 days before expiry.

interface ExpiryStatus {
  level: 'ok' | 'warn' | 'expired';
  daysRemaining: number;
  changedAt: Date;
}

function getExpiryStatus(passwordChangedAt: string | null): ExpiryStatus | null {
  if (!passwordChangedAt) return null;
  const changedAt = new Date(passwordChangedAt);
  if (Number.isNaN(changedAt.getTime())) return null;
  const elapsedDays = Math.floor((Date.now() - changedAt.getTime()) / DAY_MS);
  const remaining = EXPIRY_DAYS - elapsedDays;
  if (remaining <= 0) return { level: 'expired', daysRemaining: 0, changedAt };
  if (remaining <= WARN_DAYS) return { level: 'warn', daysRemaining: remaining, changedAt };
  return { level: 'ok', daysRemaining: remaining, changedAt };
}

export function PasswordSection({ passwordChangedAt }: PasswordSectionProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const newPw = watch('newPassword');

  const mutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      api.patch<{ message: string }>('/api/v1/me/password', data),
    onSuccess: () => {
      toast.success('비밀번호가 변경되었습니다.');
      reset();
    },
    onError: (err: Error) => {
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_CURRENT_PASSWORD') {
          // Surface inline so the user sees which field to fix.
          setError('currentPassword', {
            type: 'server',
            message: '현재 비밀번호가 올바르지 않습니다.',
          });
          return;
        }
        if (err.code === 'WEAK_PASSWORD') {
          setError('newPassword', {
            type: 'server',
            message: '새 비밀번호가 보안 요구 사항을 충족하지 않습니다.',
          });
          return;
        }
        // R39 A-4 — server-only check (이전 2개 해시와 비교).
        if (err.code === 'PASSWORD_REUSED') {
          setError('newPassword', {
            type: 'server',
            message: '직전에 사용한 비밀번호와 다른 값을 사용하세요.',
          });
          return;
        }
        toast.error(err.message);
        return;
      }
      toast.error('비밀번호 변경에 실패했습니다.');
    },
  });

  const onSubmit = (values: PasswordFormValues) => {
    mutation.mutate({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
  };

  const expiry = getExpiryStatus(passwordChangedAt);

  return (
    <section>
      <h2 className="text-base font-semibold text-fg">비밀번호 변경</h2>
      <p className="mt-1 text-sm text-fg-muted">
        계정 비밀번호를 변경합니다. 변경 후 다시 로그인할 필요는 없습니다.
      </p>

      {/* R39 A-4 만료 임박 배너 */}
      {expiry?.level === 'warn' ? (
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">
              비밀번호가 {expiry.daysRemaining}일 후에 만료됩니다.
            </p>
            <p className="mt-0.5 text-xs opacity-90">
              만료 후에는 로그인 시 비밀번호 변경 페이지로 이동합니다. 미리 변경해
              두는 것을 권장합니다.
            </p>
          </div>
        </div>
      ) : null}
      {expiry?.level === 'expired' ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            비밀번호가 만료되었습니다. 즉시 변경하세요.
          </p>
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-4 space-y-4 rounded-lg border border-border bg-bg p-5"
        noValidate
      >
        <div className="space-y-2">
          <Label htmlFor="pw-current" required>현재 비밀번호</Label>
          <Input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.currentPassword || undefined}
            {...register('currentPassword')}
          />
          {errors.currentPassword && (
            <p className="text-xs text-danger">{errors.currentPassword.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="pw-new" required>새 비밀번호</Label>
          <Input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            aria-describedby="pw-new-policy"
            aria-invalid={!!errors.newPassword || undefined}
            {...register('newPassword')}
          />
          <PolicyChecklist password={newPw} />
          {errors.newPassword && (
            <p className="text-xs text-danger">{errors.newPassword.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="pw-confirm" required>비밀번호 확인</Label>
          <Input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword || undefined}
            {...register('confirmPassword')}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-danger">{errors.confirmPassword.message}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          {expiry?.changedAt ? (
            <p className="text-xs text-fg-muted">
              마지막 변경:{' '}
              {expiry.changedAt.toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              })}
            </p>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            변경
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * PolicyChecklist — 실시간 정책 검증.
 *
 * 클라이언트가 검사 가능한 두 항목만 표시. "직전 2개와 다름"은 서버 응답으로
 * 결과만 알 수 있으므로 안내 텍스트로만 노출.
 */
function PolicyChecklist({ password }: { password: string }) {
  const lengthOk = password.length >= 10;
  let kinds = 0;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  if (hasLetter) kinds++;
  if (hasDigit) kinds++;
  if (hasSymbol) kinds++;
  const kindsOk = kinds >= 3;

  return (
    <ul
      id="pw-new-policy"
      className="space-y-1 text-xs text-fg-muted"
      aria-label="비밀번호 정책"
    >
      <PolicyItem ok={lengthOk} label="10자 이상" />
      <PolicyItem
        ok={kindsOk}
        label={`영문/숫자/특수 중 3종 이상 (현재 ${kinds}종)`}
      />
      {/* 서버가 검증하므로 항상 안내. ok 아이콘은 비활성. */}
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border-strong bg-bg"
        />
        <span>직전 2개 비밀번호와 다른 값 (저장 시 검증)</span>
      </li>
    </ul>
  );
}

function PolicyItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      {ok ? (
        <Check
          className={cn('h-3.5 w-3.5 shrink-0 text-success')}
          aria-label="조건 충족"
        />
      ) : (
        <X
          className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
          aria-label="조건 미충족"
        />
      )}
      <span className={ok ? 'text-fg' : 'text-fg-muted'}>{label}</span>
    </li>
  );
}
