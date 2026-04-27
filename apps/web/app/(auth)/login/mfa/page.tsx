'use client';

/**
 * /login/mfa — R40 MFA-FE.
 *
 * Second-factor verification screen. Users land here after the credentials
 * step succeeds for an MFA-enabled account: auth.ts throws
 * `MfaRequiredError(<bridgeToken>)`, login-form.tsx catches the
 * `mfa_required:<token>` code and `router.replace('/login/mfa?token=...')`.
 *
 * Flow (designer §B):
 *   1. Resolve the bridge token from `?token=` (URL) or sessionStorage. If
 *      neither is present the user typed the URL directly — bounce to /login.
 *   2. Render <MfaVerifyForm> — single input that toggles between the 6-digit
 *      TOTP code and an `XXXX-XXXX` recovery code.
 *   3. POST /api/v1/auth/mfa/verify { mfaToken, code | recoveryCode }
 *        → 200 { mfaBridgeToken } : signIn('credentials', { mfaBridge: ... })
 *           → router.replace(callbackUrl ?? '/') + router.refresh()
 *        → 401 MFA_BRIDGE_INVALID : redirect /login?error=mfa_token_expired
 *        → 400 INVALID_MFA_CODE   : decrement local attempt counter
 *        → 409 MFA_NOT_ENABLED    : redirect /login?error=mfa_disabled
 *   4. After 5 invalid-code failures the FE forcibly redirects to
 *      /login?error=mfa_locked + clears sessionStorage. The BE also tracks
 *      attempts in ActivityLog; the FE counter is just UX courtesy.
 *
 * Designer spec: docs/_specs/r40_mfa_login_security_pdf.md §B.
 * API contract: _workspace_r40/api_contract.md §2.1.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';

const MAX_ATTEMPTS = 5;

interface VerifyResponse {
  mfaBridgeToken: string;
}

interface VerifyVars {
  mfaToken: string;
  code?: string;
  recoveryCode?: string;
}

/**
 * Outer page wrapper. `useSearchParams()` requires a Suspense boundary in
 * App Router because it forces dynamic rendering — without the boundary the
 * build emits a "missing Suspense" warning and bails out of static export.
 */
export default function MfaPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-fg text-sm font-bold text-bg">
          DG
        </div>
        <h1 className="text-2xl font-semibold">2단계 인증</h1>
        <p className="text-sm text-fg-muted">
          인증기 앱의 6자리 코드를 입력하세요.
        </p>
      </header>

      <Suspense fallback={<MfaPageFallback />}>
        <MfaPageBody />
      </Suspense>
    </div>
  );
}

function MfaPageFallback() {
  return (
    <div className="app-panel flex items-center justify-center gap-2 p-6 text-sm text-fg-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>준비 중...</span>
    </div>
  );
}

function MfaPageBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get('callbackUrl') ?? undefined;
  const queryToken = searchParams?.get('token') ?? null;

  const [token, setToken] = useState<string | null>(null);
  const resolvedRef = useRef(false);

  // Resolve the bridge token exactly once on mount. We try the URL query
  // first (canonical path from login-form.tsx) and fall back to
  // sessionStorage so a user-triggered refresh on this page recovers.
  useEffect(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;

    let resolved = queryToken;
    if (!resolved) {
      try {
        resolved = sessionStorage.getItem('mfaBridgeToken');
      } catch {
        // sessionStorage may be disabled; nothing else to try.
      }
    }

    if (!resolved) {
      router.replace('/login');
      return;
    }

    // Normalize: stash whichever source we used so subsequent renders see a
    // consistent token even if the URL is later cleaned up.
    try {
      sessionStorage.setItem('mfaBridgeToken', resolved);
    } catch {
      /* ignore */
    }
    setToken(resolved);
  }, [queryToken, router]);

  // Cleanup on unmount — don't leak the bridge token across pages even on
  // happy-path navigation. (Verify-success path also cleans it explicitly.)
  useEffect(() => {
    return () => {
      try {
        sessionStorage.removeItem('mfaBridgeToken');
      } catch {
        /* ignore */
      }
    };
  }, []);

  if (!token) {
    return <MfaPageFallback />;
  }

  return <MfaVerifyForm initialToken={token} callbackUrl={callbackUrl} />;
}

interface MfaVerifyFormProps {
  initialToken: string;
  callbackUrl?: string;
  initialMode?: 'totp' | 'recovery';
}

function MfaVerifyForm({
  initialToken,
  callbackUrl,
  initialMode = 'totp',
}: MfaVerifyFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<'totp' | 'recovery'>(initialMode);
  const [value, setValue] = useState('');
  const [errorKind, setErrorKind] = useState<'invalid' | 'unknown' | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const [signingIn, setSigningIn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep autofocus following the active mode (toggle clears the value and
  // jumps focus into the new input shape).
  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const verifyMutation = useMutation<VerifyResponse, ApiError, VerifyVars>({
    mutationFn: (vars) => api.post<VerifyResponse>('/api/v1/auth/mfa/verify', vars),
    onSuccess: async (data) => {
      // Bridge to Auth.js v5 — the second-step credentials path consumes the
      // freshly minted bridge token and finally issues the session cookie.
      setSigningIn(true);
      try {
        const r = await signIn('credentials', {
          mfaBridge: data.mfaBridgeToken,
          redirect: false,
        });
        if (!r) {
          setErrorKind('unknown');
          setSigningIn(false);
          return;
        }
        if (r.error) {
          // Same bridge surface as the password path; on this leg we can't
          // get a fresh token, so kick the user back to /login.
          try {
            sessionStorage.removeItem('mfaBridgeToken');
          } catch {
            /* ignore */
          }
          router.replace('/login?error=mfa_session_lost');
          return;
        }
        try {
          sessionStorage.removeItem('mfaBridgeToken');
        } catch {
          /* ignore */
        }
        router.replace(callbackUrl ?? '/');
        router.refresh();
      } finally {
        setSigningIn(false);
      }
    },
    onError: (err) => {
      handleVerifyError(err);
    },
  });

  function handleVerifyError(err: ApiError) {
    switch (err.code) {
      case 'MFA_BRIDGE_INVALID':
        try {
          sessionStorage.removeItem('mfaBridgeToken');
        } catch {
          /* ignore */
        }
        router.replace('/login?error=mfa_token_expired');
        return;
      case 'INVALID_MFA_CODE': {
        const next = Math.max(0, attemptsLeft - 1);
        setAttemptsLeft(next);
        setErrorKind('invalid');
        if (next === 0) {
          try {
            sessionStorage.removeItem('mfaBridgeToken');
          } catch {
            /* ignore */
          }
          router.replace('/login?error=mfa_locked');
        }
        return;
      }
      case 'MFA_NOT_ENABLED':
        try {
          sessionStorage.removeItem('mfaBridgeToken');
        } catch {
          /* ignore */
        }
        router.replace('/login?error=mfa_disabled');
        return;
      default:
        setErrorKind('unknown');
        return;
    }
  }

  function submit(currentValue: string) {
    if (verifyMutation.isPending || signingIn) return;
    const trimmed = currentValue.trim();
    if (mode === 'totp') {
      if (trimmed.length !== 6) return;
      verifyMutation.mutate({ mfaToken: initialToken, code: trimmed });
    } else {
      // Recovery code is `XXXX-XXXX` (8 digits + 1 hyphen). Accept either
      // form so a user pasting from a password manager (sometimes without
      // the hyphen) doesn't get rejected client-side.
      if (trimmed.length < 8 || trimmed.length > 9) return;
      verifyMutation.mutate({ mfaToken: initialToken, recoveryCode: trimmed });
    }
  }

  // Auto-submit on full 6-digit entry (TOTP only). Recovery code submit is
  // explicit because the 8th digit doesn't unambiguously mark "done".
  useEffect(() => {
    if (mode !== 'totp') return;
    if (value.length === 6 && !verifyMutation.isPending && !signingIn) {
      submit(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mode]);

  function handleChange(raw: string) {
    setErrorKind(null);
    if (mode === 'totp') {
      setValue(raw.replace(/\D/g, '').slice(0, 6));
      return;
    }
    // Recovery: digits + hyphen. Also auto-insert a hyphen after 4 digits if
    // the user pasted/typed `12345678` straight through.
    let cleaned = raw.replace(/[^0-9-]/g, '').slice(0, 9);
    if (cleaned.length === 8 && !cleaned.includes('-')) {
      cleaned = `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
    }
    setValue(cleaned);
  }

  function handleSwitchMode(next: 'totp' | 'recovery') {
    if (verifyMutation.isPending || signingIn) return;
    setMode(next);
    setValue('');
    setErrorKind(null);
  }

  function handleSwitchAccount() {
    try {
      sessionStorage.removeItem('mfaBridgeToken');
    } catch {
      /* ignore */
    }
  }

  const errorMessage = useMemo(
    () => mapVerifyError(errorKind, mode, attemptsLeft),
    [errorKind, mode, attemptsLeft],
  );

  const submitting = verifyMutation.isPending || signingIn;
  const canSubmit =
    !submitting && (mode === 'totp' ? value.length === 6 : value.length >= 8);

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className="app-panel space-y-4 p-6"
        noValidate
      >
        <div className="space-y-2">
          <label
            htmlFor="mfa-code"
            className="text-sm font-medium text-fg"
          >
            {mode === 'totp' ? '인증 코드' : '복구 코드'}
          </label>
          {mode === 'totp' ? (
            <Input
              ref={inputRef}
              id="mfa-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              disabled={submitting}
              aria-label="2단계 인증 코드"
              aria-describedby="mfa-error"
              aria-invalid={errorKind === 'invalid' || undefined}
              className="h-12 text-center font-mono text-2xl tracking-[0.4em]"
            />
          ) : (
            <Input
              ref={inputRef}
              id="mfa-code"
              inputMode="text"
              pattern="[0-9-]{8,9}"
              maxLength={9}
              autoComplete="off"
              autoFocus
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="1234-5678"
              disabled={submitting}
              aria-label="2단계 인증 복구 코드"
              aria-describedby="mfa-error"
              aria-invalid={errorKind === 'invalid' || undefined}
              className="h-12 text-center font-mono text-xl tracking-[0.2em]"
            />
          )}
          {mode === 'recovery' ? (
            <p className="text-xs text-fg-muted">
              복구 코드는 한 번만 사용할 수 있습니다.
            </p>
          ) : null}
        </div>

        {errorMessage ? (
          <p
            id="mfa-error"
            role="alert"
            className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {errorMessage}
          </p>
        ) : (
          // Reserve aria target even when no message so SR users that focus
          // the input always have a stable describedby relationship.
          <p id="mfa-error" className="sr-only" />
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={!canSubmit}
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              확인 중…
            </span>
          ) : (
            '확인'
          )}
        </Button>

        <div className="flex items-center gap-3 px-2">
          <div className="h-px flex-1 bg-border" aria-hidden="true" />
          <span className="text-[11px] uppercase tracking-wide text-fg-subtle">또는</span>
          <div className="h-px flex-1 bg-border" aria-hidden="true" />
        </div>

        <button
          type="button"
          onClick={() =>
            handleSwitchMode(mode === 'totp' ? 'recovery' : 'totp')
          }
          disabled={submitting}
          className="block w-full text-center text-sm text-fg-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          {mode === 'totp' ? '복구 코드 사용' : '← 6자리 인증 코드 사용'}
        </button>
      </form>

      <div className="text-center text-xs text-fg-subtle">
        <Link
          href="/login"
          onClick={handleSwitchAccount}
          className="underline-offset-2 hover:text-fg-muted hover:underline"
        >
          ← 다른 계정으로 로그인
        </Link>
      </div>
    </div>
  );
}

function mapVerifyError(
  kind: 'invalid' | 'unknown' | null,
  mode: 'totp' | 'recovery',
  attemptsLeft: number,
): string | null {
  if (!kind) return null;
  switch (kind) {
    case 'invalid':
      return mode === 'totp'
        ? `인증 코드가 맞지 않습니다. (${attemptsLeft}회 더 시도 가능)`
        : `복구 코드가 맞지 않거나 이미 사용된 코드입니다. (${attemptsLeft}회 더 시도 가능)`;
    case 'unknown':
    default:
      return '인증에 실패했습니다. 다시 시도하세요.';
  }
}
