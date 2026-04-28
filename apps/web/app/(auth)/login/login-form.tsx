'use client';

// Login form (client component).
//
// - react-hook-form + zod for validation.
// - Calls Auth.js v5 signIn('credentials', ...) and reads structured errors.
// - On `account_locked`, shows a 30-minute countdown banner.
// - R33 A-1: when `NEXT_PUBLIC_KEYCLOAK_ENABLED === '1'`, renders a primary
//   `<KeycloakLoginButton>` ABOVE the credentials form (separate panel) with
//   a "또는" divider in between. The credentials submit button drops to the
//   `outline` variant so the SSO route reads as the recommended path.
//   Spec: docs/_specs/r33_backup_and_keycloak.md §A.
// - Uses shadcn/ui Input + Button (assumed under @/components/ui).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { KeycloakLoginButton } from './keycloak-button';
import { SamlLoginButton } from './saml-button';

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

  async function submitCredentials(username: string, password: string) {
    setSubmitting(true);
    setErrorCode(null);
    try {
      const res = await signIn('credentials', {
        username,
        password,
        redirect: false,
      });
      if (!res) {
        setErrorCode('unknown');
        return;
      }
      if (res.error) {
        // R40 MFA-FE — Auth.js v5 surfaces the bridge token through the
        // `code` field as `mfa_required:<base64url-jwt>` (auth.ts
        // MfaRequiredError). Detect it BEFORE the generic error path so the
        // user is whisked to the second-factor page instead of seeing a
        // misleading "로그인에 실패했습니다" banner.
        const code = res.code ?? res.error;
        if (typeof code === 'string' && code.startsWith('mfa_required:')) {
          const token = code.slice('mfa_required:'.length);
          // Mirror token into sessionStorage so a refresh on /login/mfa
          // (which would drop the query param off History.state) recovers.
          try {
            sessionStorage.setItem('mfaBridgeToken', token);
          } catch {
            // sessionStorage may be disabled (incognito quota / SSR fallback);
            // the URL query string still carries the token.
          }
          const search = new URLSearchParams();
          search.set('token', token);
          if (callbackUrl) search.set('callbackUrl', callbackUrl);
          router.replace(`/login/mfa?${search.toString()}`);
          return;
        }
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

  async function onSubmit(values: FormValues) {
    await submitCredentials(values.username, values.password);
  }

  // TODO(remove-before-prod): 정식 서비스 전 테스트 로그인 버튼 제거.
  async function onTestAdminLogin() {
    await submitCredentials('admin', 'admin123!');
  }

  const locked = errorCode === 'account_locked' && remainingSec > 0;

  // R33 A-1 — SSO is opt-in via build-time env. The server-side
  // `KEYCLOAK_ENABLED` gates the actual provider in `auth.ts`; this client
  // mirror prevents users from clicking a button that would land on a
  // configuration error.
  // R37 A-2 — SAML provider gated independently. Either, both, or neither
  // SSO provider may be enabled; the divider/credentials form behavior keys
  // off `anySsoEnabled` so a SAML-only deployment still shows "또는".
  const keycloakEnabled = process.env.NEXT_PUBLIC_KEYCLOAK_ENABLED === '1';
  const samlEnabled = process.env.NEXT_PUBLIC_SAML_ENABLED === '1';
  const anySsoEnabled = keycloakEnabled || samlEnabled;
  const ssoEnabled = anySsoEnabled; // legacy alias kept for the form below.

  return (
    <div className="space-y-4">
      {anySsoEnabled ? (
        <>
          <div className="app-panel space-y-2 p-6">
            {keycloakEnabled ? (
              <KeycloakLoginButton
                callbackUrl={callbackUrl}
                disabled={locked || submitting}
              />
            ) : null}
            {samlEnabled ? (
              <SamlLoginButton
                callbackUrl={callbackUrl}
                disabled={locked || submitting}
              />
            ) : null}
          </div>
          <div
            className="flex items-center gap-3 px-2"
            role="separator"
            aria-orientation="horizontal"
          >
            <div className="h-px flex-1 bg-border" aria-hidden="true" />
            <span className="text-[11px] uppercase tracking-wide text-fg-subtle">또는</span>
            <div className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
        </>
      ) : null}

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="app-panel space-y-4 p-6"
        noValidate
      >
        <div className="space-y-2">
          <label
            htmlFor="username"
            className="text-sm font-medium text-fg"
          >
            아이디
          </label>
          <Input
            id="username"
            type="text"
            autoComplete="username"
            autoFocus={!ssoEnabled}
            disabled={locked || submitting}
            aria-invalid={!!errors.username || undefined}
            {...register('username')}
          />
          {errors.username ? (
            <p className="text-xs text-danger">{errors.username.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="password"
            className="text-sm font-medium text-fg"
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
            <p className="text-xs text-danger">{errors.password.message}</p>
          ) : null}
        </div>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {errorMessage}
            {locked ? (
              <span className="block text-xs opacity-80">
                잠금 해제까지 {formatRemaining(remainingSec)} 남음
              </span>
            ) : null}
          </div>
        ) : null}

        {/* R33 A-1: when SSO is enabled, drop the credentials submit to
            secondary (outline) so the SSO panel above remains primary. When
            SSO is disabled, this is the only sign-in path so it stays brand. */}
        <Button
          type="submit"
          variant={ssoEnabled ? 'outline' : 'default'}
          className="w-full"
          disabled={locked || submitting}
        >
          {submitting ? '로그인 중…' : '로그인'}
        </Button>

        {/* TODO(remove-before-prod): 정식 서비스 전 테스트 로그인 버튼 제거. */}
        <div className="space-y-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            className="w-full border-dashed"
            disabled={locked || submitting}
            onClick={onTestAdminLogin}
          >
            테스트 관리자 로그인 (SUPER_ADMIN)
          </Button>
          <p className="text-center text-xs text-fg-muted">
            개발/테스트용 계정입니다. 운영 배포 전 제거 예정입니다.
          </p>
        </div>
      </form>
    </div>
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
    // R33 A-1 — Auth.js OIDC error codes returned via `?error=` on the login
    // route after a failed Keycloak callback. Spec §A.4.
    case 'OAuthSignin':
    case 'OAuthCallback':
      return '사내 SSO 로그인에 실패했습니다. 잠시 후 다시 시도하세요.';
    case 'OAuthAccountNotLinked':
      return '이미 다른 방식으로 가입된 계정입니다. 관리자에게 문의하세요.';
    case 'AccessDenied':
      return '접근이 거부되었습니다. 관리자에게 문의하세요.';
    // R40 MFA-FE — surfaced when /login/mfa kicks the user back here because
    // the bridge token expired, was forged, or the per-attempt counter hit
    // its cap. Spec docs/_specs/r40_mfa_login_security_pdf.md §A.3.
    case 'mfa_token_expired':
      return '인증 시간이 만료되었습니다. 처음부터 다시 로그인하세요.';
    case 'mfa_locked':
    case 'mfa_session_lost':
      return '인증 시도 횟수를 초과했거나 세션이 만료되었습니다. 처음부터 다시 로그인하세요.';
    case 'mfa_disabled':
      return '2단계 인증이 비활성화되었습니다. 처음부터 다시 로그인하세요.';
    // R48 — backend의 LoginRateLimitedError가 surface시키는 코드. 윈도우가
    // 1분으로 짧아 카운트다운 UI 없이 단순 안내만 노출한다.
    case 'rate_limited':
      return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.';
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
