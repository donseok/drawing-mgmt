'use client';

// Login form (client component).
//
// - react-hook-form + zod for validation.
// - Calls Auth.js v5 signIn('credentials', ...) and reads structured errors.
// - On `account_locked`, shows a 30-minute countdown banner.
// - Uses shadcn/ui Input + Button (assumed under @/components/ui).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const formSchema = z.object({
  username: z.string().min(1, '아이디를 입력하세요.'),
  password: z.string().min(1, '비밀번호를 입력하세요.'),
});

type FormValues = z.infer<typeof formSchema>;

const LOCK_DURATION_SEC = 30 * 60;

export function LoginForm({
  callbackUrl,
  initialError,
}: {
  callbackUrl?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(initialError ?? null);
  const [lockEndsAt, setLockEndsAt] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: '', password: '' },
  });

  const remainingSec = useCountdown(lockEndsAt);

  const errorMessage = useMemo(
    () => mapErrorCode(errorCode),
    [errorCode],
  );

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    setErrorCode(null);
    try {
      const res = await signIn('credentials', {
        username: values.username,
        password: values.password,
        redirect: false,
      });
      if (!res) {
        setErrorCode('unknown');
        return;
      }
      if (res.error) {
        // Auth.js v5 returns the CredentialsSignin.code as `code` in error
        // (e.g. 'invalid_credentials', 'account_locked').
        setErrorCode(res.code ?? res.error);
        if ((res.code ?? res.error) === 'account_locked') {
          setLockEndsAt(Date.now() + LOCK_DURATION_SEC * 1000);
        }
        return;
      }
      router.replace(callbackUrl ?? '/');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const locked = errorCode === 'account_locked' && remainingSec > 0;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border bg-white p-6 shadow-sm dark:bg-zinc-950"
      noValidate
    >
      <div className="space-y-2">
        <label
          htmlFor="username"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-200"
        >
          아이디
        </label>
        <Input
          id="username"
          type="text"
          autoComplete="username"
          autoFocus
          disabled={locked || submitting}
          aria-invalid={!!errors.username || undefined}
          {...register('username')}
        />
        {errors.username ? (
          <p className="text-xs text-red-600">{errors.username.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="password"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-200"
        >
          비밀번호
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          disabled={locked || submitting}
          aria-invalid={!!errors.password || undefined}
          {...register('password')}
        />
        {errors.password ? (
          <p className="text-xs text-red-600">{errors.password.message}</p>
        ) : null}
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {errorMessage}
          {locked ? (
            <span className="block text-xs opacity-80">
              잠금 해제까지 {formatRemaining(remainingSec)} 남음
            </span>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={locked || submitting}>
        {submitting ? '로그인 중…' : '로그인'}
      </Button>
    </form>
  );
}

function mapErrorCode(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case 'invalid_credentials':
    case 'CredentialsSignin':
      return '아이디 또는 비밀번호가 올바르지 않습니다.';
    case 'account_locked':
      return '로그인 5회 실패로 계정이 잠겼습니다. 잠시 후 다시 시도하세요.';
    default:
      return '로그인에 실패했습니다. 다시 시도하세요.';
  }
}

function useCountdown(endsAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

function formatRemaining(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}분 ${s.toString().padStart(2, '0')}초`;
}
