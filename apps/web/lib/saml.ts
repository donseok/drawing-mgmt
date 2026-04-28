// R37 / A-2 — SAML 2.0 SSO helper.
//
// Wraps `@node-saml/node-saml` (MIT) to expose three primitives consumed by
// the SAML route handlers under `app/api/v1/auth/saml/`:
//
//   1. `getSamlConfig()`              — gates SAML behind SAML_ENABLED + reads
//                                       env into a SamlConfig (mandatory: idp
//                                       cert/entry-point, SP entity id, ACS).
//   2. `getServiceProviderMetadata()` — XML response served at /metadata.
//   3. `getLoginRedirectUrl()`        — builds the IdP authn request URL
//                                       (HTTP-Redirect binding by default).
//   4. `validateAcsResponse(body)`    — validates a SAMLResponse posted to
//                                       /acs and returns the parsed Profile.
//
// We also export `pickSamlIdentity()` to normalize the IdP's wildly varying
// attribute naming (urn:oid:0.9.2342.19200300.100.1.1, http://schemas.xmlsoap.
// org/ws/2005/05/identity/claims/emailaddress, plain "username"/"email", …)
// into the three fields the provisioner cares about: { sub, email, fullName }.
//
// Auth.js v5 has no native SAML provider — we rely on a Credentials provider
// "saml-bridge" mode (apps/web/auth.ts) keyed off a short-lived signed token
// minted by the ACS handler. That keeps the JWT session contract identical to
// the credentials and Keycloak paths.

import {
  SAML,
  generateServiceProviderMetadata,
  ValidateInResponseTo,
  type Profile,
  type SamlConfig,
} from '@node-saml/node-saml';
import crypto from 'node:crypto';
import { samlCacheProvider } from '@/lib/saml-cache';

// ── Env config ────────────────────────────────────────────────────────────

/** True when the SAML provider is wired and required envs are present. */
export function isSamlEnabled(): boolean {
  if (process.env.SAML_ENABLED !== '1') return false;
  return Boolean(
    process.env.SAML_IDP_ENTRY_POINT &&
      process.env.SAML_IDP_CERT &&
      process.env.SAML_SP_ENTITY_ID,
  );
}

/**
 * Build a `SamlConfig` from process.env. Throws if SAML is not fully
 * configured — callers should guard with `isSamlEnabled()` first or be
 * prepared to surface 503/500 to the IdP.
 */
export function getSamlConfig(): SamlConfig {
  const entryPoint = process.env.SAML_IDP_ENTRY_POINT;
  const idpCert = process.env.SAML_IDP_CERT;
  const issuer = process.env.SAML_SP_ENTITY_ID;
  const privateKey = process.env.SAML_SP_PRIVATE_KEY;

  if (!entryPoint || !idpCert || !issuer) {
    throw new Error(
      '[saml] missing required env: SAML_IDP_ENTRY_POINT, SAML_IDP_CERT, SAML_SP_ENTITY_ID',
    );
  }

  const callbackUrl = `${getBaseUrl()}/api/v1/auth/saml/acs`;

  // Cert may be passed in either as a single PEM blob or as a base64-stripped
  // bare body (no BEGIN/END headers). `@node-saml/node-saml` accepts both
  // forms but is happier with the headered version, so we patch it on if
  // missing. Callers can also pass multiple certs separated by `;` (rotation).
  const idpCertNormalized = idpCert
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .map(normalizeCertPem);

  return {
    entryPoint,
    issuer,
    callbackUrl,
    idpCert: idpCertNormalized.length === 1 ? idpCertNormalized[0]! : idpCertNormalized,
    // We don't currently sign authn requests — most corporate IdPs don't
    // require it. Flip to required + populate SAML_SP_PRIVATE_KEY when the
    // IdP demands signed requests.
    privateKey: privateKey || undefined,
    // Persistent NameID is the most stable identifier the IdP will hand us.
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
    // `wantAssertionsSigned: true` is the secure default — refuse responses
    // where the assertion XML element itself isn't signed (vs. only the
    // outer Response).
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    // R50 / FIND-007 — InResponseTo enforcement.
    //
    // When REDIS_URL is set we wire a Redis-backed CacheProvider (see
    // lib/saml-cache.ts) that persists the request id across web replicas,
    // so node-saml can reject SAMLResponses that don't match a request we
    // just minted. This closes the replay window the audit flagged.
    //
    // Without Redis we keep the previous 'never' behavior so single-instance
    // dev still works (the in-memory CacheProvider can't cover multi-replica
    // anyway, so partial enforcement would be misleading).
    validateInResponseTo: process.env.REDIS_URL
      ? ValidateInResponseTo.always
      : ValidateInResponseTo.never,
    cacheProvider: process.env.REDIS_URL ? samlCacheProvider : undefined,
    // 5min clock-skew tolerance is the typical Active Directory federation
    // default. Tighten if your IdP/SP clocks are tightly synced.
    acceptedClockSkewMs: 5 * 60 * 1000,
    disableRequestedAuthnContext: true,
  };
}

/** Best-effort base URL — prefers NEXTAUTH_URL, falls back to localhost. */
function getBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    'http://localhost:3000'
  );
}

/**
 * Make a PEM blob with proper BEGIN/END markers, even if the env supplies
 * just the base64 body (common when stuffing certs into Kubernetes secrets).
 */
function normalizeCertPem(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('BEGIN CERTIFICATE')) return trimmed;
  // Wrap in 64-char lines per RFC 7468.
  const wrapped = trimmed.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? trimmed;
  return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----`;
}

// ── Public API ────────────────────────────────────────────────────────────

/** XML SP metadata served at /api/v1/auth/saml/metadata. */
export function getServiceProviderMetadata(): string {
  const cfg = getSamlConfig();
  return generateServiceProviderMetadata({
    issuer: cfg.issuer,
    callbackUrl: cfg.callbackUrl,
    // Re-publish our public cert for IdPs that want to verify our authn
    // request signatures. Optional — undefined when SAML_SP_PRIVATE_KEY is
    // unset (we don't sign requests in that case anyway).
    publicCerts: process.env.SAML_SP_PUBLIC_CERT ?? undefined,
    wantAssertionsSigned: true,
    identifierFormat: cfg.identifierFormat,
  });
}

/**
 * Build the IdP entry URL with `SAMLRequest` query param so the caller can
 * `Response.redirect(url)`. RelayState is propagated so we land on the user's
 * original destination after the round-trip (mirrors callbackUrl in OIDC).
 */
export async function getLoginRedirectUrl(relayState: string): Promise<string> {
  const cfg = getSamlConfig();
  const saml = new SAML(cfg);
  // host is only used for InResponseTo lookups (which we don't enforce).
  return saml.getAuthorizeUrlAsync(relayState, undefined, {});
}

/**
 * Validate a SAMLResponse received via HTTP-POST binding (form-encoded body
 * with `SAMLResponse` field, base64-encoded XML). Returns the IdP-asserted
 * profile or throws with a generic 'invalid SAML response' message — we
 * intentionally do NOT echo the underlying validation error to the browser
 * because some IdP errors leak signature internals.
 */
export async function validateAcsResponse(body: {
  SAMLResponse: string;
  RelayState?: string;
}): Promise<Profile> {
  const cfg = getSamlConfig();
  const saml = new SAML(cfg);
  const { profile, loggedOut } = await saml.validatePostResponseAsync({
    SAMLResponse: body.SAMLResponse,
    ...(body.RelayState ? { RelayState: body.RelayState } : {}),
  });
  if (loggedOut || !profile) {
    throw new Error('saml.validate: empty profile');
  }
  return profile;
}

// ── Identity normalization ────────────────────────────────────────────────

/** Subset of attributes we extract from the SAML profile. */
export interface SamlIdentity {
  /** Stable subject — NameID (preferred) or email/uid fallback. */
  sub: string;
  /** Display name fallback chain: cn → displayName → givenName + sn → username. */
  fullName: string;
  /** Mailbox if asserted; null otherwise. */
  email: string | null;
  /** Preferred login handle — falls back to email local-part or sub. */
  username: string;
}

/**
 * Pluck a claim from a SAML Profile considering the multiple naming schemes
 * IdPs use (urn:oid:*, http://schemas.xmlsoap.org/*, plain attribute names).
 */
function pluck(profile: Profile, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = profile[k];
    if (typeof v === 'string' && v.length > 0) return v;
    // Some IdPs return single values as one-element arrays.
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0].length > 0) {
      return v[0];
    }
  }
  return null;
}

/** Normalize an IdP-asserted Profile into our SamlIdentity shape. */
export function pickSamlIdentity(profile: Profile): SamlIdentity {
  // Subject — NameID is canonical. Some IdPs put it on `nameID`, some on
  // `nameid`, some only via `urn:oasis:...:nameid-format:*` attribute. We
  // prefer profile.nameID (set by the lib) and fall back to email/uid.
  const sub =
    profile.nameID ||
    pluck(
      profile,
      'urn:oid:0.9.2342.19200300.100.1.1', // uid
      'urn:oasis:names:tc:SAML:attribute:subject-id',
      'http://schemas.microsoft.com/identity/claims/objectidentifier',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
      'username',
      'sub',
    ) ||
    null;

  if (!sub) {
    throw new Error('saml.profile: missing NameID/sub');
  }

  const email =
    pluck(
      profile,
      'urn:oid:0.9.2342.19200300.100.1.3', // mail
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
      'email',
      'mail',
      'EmailAddress',
    ) || null;

  const givenName = pluck(
    profile,
    'urn:oid:2.5.4.42',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    'givenName',
    'firstName',
  );
  const surName = pluck(
    profile,
    'urn:oid:2.5.4.4',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
    'sn',
    'lastName',
  );
  const cn = pluck(
    profile,
    'urn:oid:2.5.4.3', // cn
    'http://schemas.microsoft.com/identity/claims/displayname',
    'displayName',
    'name',
    'cn',
  );

  const fullName =
    cn ||
    [givenName, surName].filter(Boolean).join(' ').trim() ||
    pluck(profile, 'urn:oid:0.9.2342.19200300.100.1.1', 'uid', 'username') ||
    sub;

  // username — preferred login handle. Some Korean enterprise IdPs return a
  // `samaccountname` or similar; fall back to email local-part then sub.
  const username =
    pluck(
      profile,
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/windowsaccountname',
      'sAMAccountName',
      'samaccountname',
      'preferred_username',
      'preferredUsername',
      'uid',
      'username',
    ) ||
    (email ? email.split('@')[0]! : sub);

  return { sub, email, fullName, username };
}

// ── Bridge token ──────────────────────────────────────────────────────────
//
// Auth.js v5 has no native SAML provider — instead, after the ACS endpoint
// validates the SAMLResponse it mints a short-lived signed bridge token and
// hands it to the Credentials provider via a same-origin redirect to
// /login/saml-callback?token=… . The Credentials provider's "saml-bridge"
// mode (auth.ts) verifies the HMAC + ttl and resolves the User row that
// the ACS endpoint already provisioned — we never round-trip the password.
//
// Token format: base64url(JSON({ uid, exp })) "." base64url(HMAC-SHA256).
// AUTH_SECRET is reused as the HMAC key — it's already a 32-char secret in
// production and is mandatory for Auth.js anyway.

const BRIDGE_TTL_MS = 60 * 1000; // 1 minute

function getBridgeKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('[saml] AUTH_SECRET must be set to mint bridge tokens');
  }
  return crypto.createHash('sha256').update(`saml-bridge:${secret}`).digest();
}

/** Mint a single-use, short-lived bridge token referencing a provisioned User.id. */
export function mintSamlBridgeToken(userId: string): string {
  const payload = JSON.stringify({ uid: userId, exp: Date.now() + BRIDGE_TTL_MS });
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getBridgeKey())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verify a bridge token; returns userId on success or null on any failure
 * (bad signature, expired, malformed). Constant-time comparison.
 */
export function verifySamlBridgeToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];

  const expected = crypto
    .createHmac('sha256', getBridgeKey())
    .update(body)
    .digest('base64url');

  // Constant-time compare. Lengths must match for timingSafeEqual.
  let sigBuf: Buffer;
  let expBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, 'base64url');
    expBuf = Buffer.from(expected, 'base64url');
  } catch {
    return null;
  }
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      uid?: unknown;
      exp?: unknown;
    };
    if (typeof decoded.uid !== 'string' || typeof decoded.exp !== 'number') {
      return null;
    }
    if (decoded.exp < Date.now()) return null;
    return decoded.uid;
  } catch {
    return null;
  }
}
