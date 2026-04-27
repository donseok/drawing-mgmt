// R39 / A-3 — TOTP helpers + MFA bridge token.
//
// Wraps `otpauth` (MIT) for the secret/QR pipeline and `qrcode` (MIT) for
// the PNG dataURL the FE renders during enroll.
//
// Three areas of behavior:
//
//   1. enroll/confirm/verify primitives
//      - generateSecret()       random base32 (otpauth.Secret)
//      - buildOtpauthUrl(...)   issuer + label string for QR scanner apps
//      - generateQrDataUrl(...) PNG dataURL for the enroll screen
//      - verifyTotp(secret, code) ±1 step window (RFC 6238 default tolerance)
//
//   2. recovery codes
//      - generateRecoveryCodes(n) plaintext codes (FE shows once)
//      - hashRecoveryCode(code)   bcrypt; matches User.recoveryCodesHash[]
//
//   3. MFA bridge token (HMAC, 5min ttl)
//      - mintMfaBridgeToken(userId)
//      - verifyMfaBridgeToken(token) → userId | null
//      Mirrors the SAML bridge in lib/saml.ts. Used by the login 2-step
//      flow: after Credentials.authorize() succeeds and the user has MFA on,
//      we mint a bridge and let /api/v1/auth/mfa/verify swap it for a real
//      session via the Credentials provider's `mfaBridge` mode.
//
// We deliberately depend on `otpauth` (which is pure JS, MIT-licensed) and
// not on any GPL OTP library — this keeps the web app code firmly MIT/Apache
// per the project license policy.

import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

// ── TOTP primitives ────────────────────────────────────────────────────────

/** Default TOTP knobs — RFC 6238 standard, scanner-app friendly. */
const TOTP_DEFAULTS = {
  algorithm: 'SHA1' as const,
  digits: 6 as const,
  period: 30 as const,
};

/** Generate a cryptographically random base32 TOTP secret (160 bits). */
export function generateSecret(): string {
  // 20 bytes = 160 bits, the recommended length per RFC 4226 §4. otpauth's
  // `Secret` constructor returns a base32 representation we can persist.
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/**
 * Build an otpauth:// URI for QR scanning. `issuer` becomes the label prefix
 * in Google Authenticator / 1Password and disambiguates which app the code
 * came from when the user has many enrolments.
 */
export function buildOtpauthUrl(opts: {
  secret: string;
  label: string;
  issuer?: string;
}): string {
  const totp = new OTPAuth.TOTP({
    issuer: opts.issuer ?? 'drawing-mgmt',
    label: opts.label,
    secret: OTPAuth.Secret.fromBase32(opts.secret),
    ...TOTP_DEFAULTS,
  });
  return totp.toString();
}

/**
 * Render an otpauth URI as a base64 PNG data URL the FE can drop straight
 * into `<img src=...>`. Width/error-correction tuned for phone scans.
 */
export async function generateQrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, {
    type: 'image/png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 256,
  });
}

/**
 * Verify a 6-digit TOTP `code` against `secret`. Returns true on match.
 *
 * `window: 1` = ±1 30s step (= 60s total grace) — covers minor clock skew
 * between user device and server without being so wide it weakens 2FA.
 */
export function verifyTotp(secret: string, code: string): boolean {
  // Strip whitespace + hyphens so users can paste "123 456" / "123-456".
  const normalized = code.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;

  let secretObj: OTPAuth.Secret;
  try {
    secretObj = OTPAuth.Secret.fromBase32(secret);
  } catch {
    return false;
  }

  const totp = new OTPAuth.TOTP({
    secret: secretObj,
    ...TOTP_DEFAULTS,
  });
  // `validate` returns the delta (in steps) on match, or null on miss.
  const delta = totp.validate({ token: normalized, window: 1 });
  return delta !== null;
}

// ── Recovery codes ─────────────────────────────────────────────────────────

const RECOVERY_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 10; // recovery codes are already 80 bits of entropy

/**
 * Generate `n` recovery codes as `xxxx-xxxx-xxxx` (12 hex chars + dashes).
 * The plaintext is shown to the user exactly once at /confirm; we persist
 * only the bcrypt hashes.
 */
export function generateRecoveryCodes(n: number = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    // 6 random bytes → 12 hex chars, grouped into 3-3-3-3 with `-`.
    const hex = crypto.randomBytes(6).toString('hex'); // 12 chars
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`);
  }
  return codes;
}

/** bcrypt-hash a plaintext recovery code for storage in `User.recoveryCodesHash`. */
export async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(code.trim().toLowerCase(), BCRYPT_ROUNDS);
}

/**
 * Try every stored hash for a match. On success returns the matching index
 * (caller should splice it out of the array so each code is single-use).
 * Constant-time-ish: we always iterate every hash, even after a hit, to
 * dampen timing leaks of "how many codes were left".
 */
export async function findMatchingRecoveryCode(
  plain: string,
  hashes: readonly string[],
): Promise<number> {
  const normalized = plain.trim().toLowerCase();
  if (!/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/.test(normalized)) return -1;

  let matchIdx = -1;
  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i];
    if (!hash) continue;
    // We could short-circuit on first match; we don't, to keep timing flat.
    const ok = await bcrypt.compare(normalized, hash);
    if (ok && matchIdx === -1) matchIdx = i;
  }
  return matchIdx;
}

// ── MFA bridge token ───────────────────────────────────────────────────────
//
// Auth.js v5 pre-emptively calls `authorize` once per signIn invocation, so
// we can't pause inside it for a 2nd-factor prompt. Instead, when the user
// has MFA on we throw a stable error from `authorize` (or short-circuit via
// a separate endpoint) and hand the FE a short-lived signed token. The
// /api/v1/auth/mfa/verify endpoint accepts the bridge + 6-digit code and,
// on match, completes the actual signIn via the Credentials provider's
// `mfaBridge` mode.
//
// Token format: base64url(JSON({ uid, exp })) "." base64url(HMAC-SHA256).
// Reuses AUTH_SECRET as the HMAC key root with a domain prefix so a bridge
// cannot be replayed as a SAML bridge or vice-versa.

const MFA_BRIDGE_TTL_MS = 5 * 60 * 1000; // 5 min

function getMfaBridgeKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('[totp] AUTH_SECRET must be set to mint MFA bridge tokens');
  }
  return crypto.createHash('sha256').update(`mfa-bridge:${secret}`).digest();
}

export function mintMfaBridgeToken(userId: string): string {
  const payload = JSON.stringify({
    uid: userId,
    exp: Date.now() + MFA_BRIDGE_TTL_MS,
  });
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getMfaBridgeKey())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verify a bridge token; returns userId on success or null on any failure.
 * Constant-time signature comparison.
 */
export function verifyMfaBridgeToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];

  const expected = crypto
    .createHmac('sha256', getMfaBridgeKey())
    .update(body)
    .digest('base64url');

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
