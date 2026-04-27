// R37 / A-2 — SAML login initiator.
//
// Receives the user's click on "SAML SSO 로그인" and returns a 302 to the
// IdP's entry point with a `SAMLRequest` query param (HTTP-Redirect binding).
// The IdP authenticates the user out-of-band and POSTs back to our ACS
// endpoint at /api/v1/auth/saml/acs with a SAMLResponse + RelayState.
//
// Inputs:
//   - ?callbackUrl=/some/path   — where to land after a successful SSO trip.
//                                 Defaults to "/". We propagate this as
//                                 RelayState so it survives the IdP round-trip.
//
// SAML_ENABLED=0 → 404 (parity with metadata endpoint).

import { NextResponse, type NextRequest } from 'next/server';
import { getLoginRedirectUrl, isSamlEnabled } from '@/lib/saml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  if (!isSamlEnabled()) {
    return new NextResponse('SAML not configured', { status: 404 });
  }

  // Sanitize callbackUrl — only same-origin relative paths are allowed so we
  // can't be turned into an open-redirect via RelayState. Default to "/".
  const requested = req.nextUrl.searchParams.get('callbackUrl');
  const relayState = sanitizeRelay(requested);

  try {
    const url = await getLoginRedirectUrl(relayState);
    return NextResponse.redirect(url, { status: 302 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[saml.login]', err);
    return new NextResponse('SAML login init failed', { status: 500 });
  }
}

/**
 * Allow only same-origin relative paths starting with `/` (and not `//`,
 * which browsers treat as scheme-relative). Anything else collapses to "/".
 */
function sanitizeRelay(input: string | null): string {
  if (!input) return '/';
  if (!input.startsWith('/')) return '/';
  if (input.startsWith('//')) return '/';
  // Cap length to avoid stuffing huge payloads through RelayState.
  return input.length > 512 ? '/' : input;
}
