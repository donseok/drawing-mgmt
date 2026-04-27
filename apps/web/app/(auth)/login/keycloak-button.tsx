'use client';

// R33 A-1 — Keycloak SSO login button.
// Spec: docs/_specs/r33_backup_and_keycloak.md §A.3 + §C.1.
//
// Single-purpose primary button that fronts `signIn('keycloak', { callbackUrl })`.
// Lives in its own file (rather than inline in login-form.tsx) so it can be
// rendered conditionally as a sibling of the credentials <form> without ever
// being submitted as part of that form (we keep `type="button"` defensively
// even though it's not inside the form).

import * as React from 'react';
import { signIn } from 'next-auth/react';
import { KeyRound, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface KeycloakLoginButtonProps {
  /** Forwarded to next-auth `signIn` so the user lands on the page they
   *  originally requested (e.g. deep-linked /admin/users). */
  callbackUrl?: string;
  /** Sync with parent form's lock state (rare, but keeps wcag focus order). */
  disabled?: boolean;
  className?: string;
}

export function KeycloakLoginButton({
  callbackUrl,
  disabled,
  className,
}: KeycloakLoginButtonProps): JSX.Element {
  const [submitting, setSubmitting] = React.useState(false);

  async function onClick() {
    setSubmitting(true);
    try {
      // `redirect: true` (default) — next-auth handles the OIDC bounce. The
      // component will unmount during the navigation so we don't bother
      // resetting `submitting`. If signIn ever throws synchronously we fall
      // back to the catch (rare).
      await signIn('keycloak', { callbackUrl: callbackUrl ?? '/' });
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled || submitting}
      aria-label="사내 SSO로 로그인"
      className={cn(
        // h-10 = 40px (slightly taller than credentials submit at h-9) to
        // reinforce the primary visual weight when both buttons coexist.
        'h-10 w-full text-sm font-medium',
        className,
      )}
    >
      {submitting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          사내 SSO로 이동 중…
        </>
      ) : (
        <>
          <KeyRound className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
          사내 SSO 로그인
        </>
      )}
    </Button>
  );
}
