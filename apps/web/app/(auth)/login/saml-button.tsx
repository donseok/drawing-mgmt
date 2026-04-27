'use client';

// R37 A-2 — SAML SSO login button.
// Spec: _workspace/api_contract.md §3.3.
//
// Mirrors the KeycloakLoginButton shape but uses a server-side redirect to the
// SP-initiated login endpoint instead of next-auth's `signIn`. The contract
// (§3.1) deliberately implements SAML as bespoke ACS/metadata routes rather
// than going through Auth.js's provider plumbing, so we navigate the browser
// directly and let the server respond with a 302 to the IdP entry point.
//
// The component is rendered as a sibling of the credentials <form> (not inside
// it) — see login-form.tsx — so `type="button"` is defensive only.

import * as React from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface SamlLoginButtonProps {
  /** Forwarded as a `?callbackUrl=` query param so the SAML ACS handler knows
   *  where to land the user after a successful assertion. */
  callbackUrl?: string;
  /** Sync with parent form's lock state to keep tab/focus order coherent. */
  disabled?: boolean;
  className?: string;
}

export function SamlLoginButton({
  callbackUrl,
  disabled,
  className,
}: SamlLoginButtonProps): JSX.Element {
  const [submitting, setSubmitting] = React.useState(false);

  function onClick() {
    setSubmitting(true);
    // Hand the browser to the server. The server route redirects (302) to the
    // configured IdP entry point with a SAMLRequest. We never come back here
    // until the IdP POSTs to /api/v1/auth/saml/acs, so we don't bother
    // resetting `submitting`.
    const target = callbackUrl
      ? `/api/v1/auth/saml/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : '/api/v1/auth/saml/login';
    window.location.assign(target);
  }

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled || submitting}
      aria-label="SAML SSO로 로그인"
      className={cn(
        // h-10 matches KeycloakLoginButton so the two SSO buttons line up
        // visually when both providers are enabled simultaneously.
        'h-10 w-full text-sm font-medium',
        className,
      )}
    >
      {submitting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          SAML SSO로 이동 중…
        </>
      ) : (
        <>
          <ShieldCheck className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
          SAML SSO 로그인
        </>
      )}
    </Button>
  );
}
