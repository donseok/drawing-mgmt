// R40 / R39 finish — MFA bridge token re-exports.
//
// The actual HMAC mint/verify primitives live in `lib/totp.ts` alongside the
// TOTP and recovery-code helpers (they share `AUTH_SECRET` derivation and
// the same domain-separation prefix). This module exists to surface those
// primitives at the path the API contract calls out (`lib/mfa-bridge.ts`)
// and to mirror the SAML bridge module layout (`lib/saml.ts` ←→ this file
// as `lib/mfa-bridge.ts`), keeping the two SSO-style "bridge" patterns
// addressable side-by-side when grepping the codebase.
//
// Naming alignment: SAML uses `mintSamlBridgeToken/verifySamlBridgeToken`,
// so we expose `mintMfaToken/verifyMfaToken` aliases too — matching the
// contract's documentation of those names — while keeping the canonical
// `*BridgeToken` exports for backward-compat.

export {
  mintMfaBridgeToken,
  verifyMfaBridgeToken,
} from '@/lib/totp';

import {
  mintMfaBridgeToken as _mint,
  verifyMfaBridgeToken as _verify,
} from '@/lib/totp';

/** Alias of `mintMfaBridgeToken` — matches the contract naming. */
export function mintMfaToken(userId: string): string {
  return _mint(userId);
}

/** Alias of `verifyMfaBridgeToken` — matches the contract naming. */
export function verifyMfaToken(token: string): string | null {
  return _verify(token);
}
