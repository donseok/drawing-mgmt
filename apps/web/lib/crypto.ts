// R49 / FIND-008 — symmetric at-rest encryption for sensitive secrets
// (currently only the TOTP `User.totpSecret` column).
//
// Why a tiny module instead of pulling a library:
//   - Node's `crypto` ships with a battle-tested AES-256-GCM implementation;
//     the perimeter we need is small (encrypt → string, decrypt → string).
//   - Pulling a third-party crypto package would expand the supply-chain
//     review surface for ~30 lines of behavior we can audit ourselves.
//   - Keeps the module synchronous and side-effect-free so callers can use
//     it from server components without ceremony.
//
// Format (versioned for future key rotation):
//   <ver>:<iv-b64url>:<tag-b64url>:<cipher-b64url>
//   ver = "v1"             constant prefix; future versions bump this string
//   iv  = 12 random bytes  GCM-recommended nonce length
//   tag = 16 bytes          GCM auth tag (bound integrity)
//   cipher = ciphertext     AES-256-GCM(plaintext)
//
// Key derivation:
//   scrypt(AUTH_SECRET, fixed-domain-salt, 32) — AUTH_SECRET is already a
//   high-entropy, deployment-rotated value used by Auth.js. We deliberately
//   do *not* take user input here; if AUTH_SECRET rotates, all encrypted
//   blobs become unreadable, which is the intended behavior (forces a
//   re-enroll for affected users — same as for Auth.js sessions).
//
// Backward-compat:
//   `decryptSecret` returns the input unchanged when the `v1:` prefix is
//   absent. This lets pre-R49 plaintext rows continue to verify; the next
//   enroll/confirm path re-saves them through `encryptSecret` so the
//   plaintext footprint shrinks naturally over time.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM-recommended
const TAG_LEN = 16;

/**
 * Current key/format version. Bump (and add a parallel branch in
 * `decryptSecret`) when rotating to a new derivation or AEAD. The prefix
 * doubles as a sentinel for `isEncryptedSecret`.
 */
export const KEY_VERSION = 'v1' as const;
const KEY_PREFIX = `${KEY_VERSION}:`;

// Domain-separation salt: ensures the derived key is scoped to "totp"
// usage even if a future caller wants a different sub-key from AUTH_SECRET.
// Fixed-string-as-salt is fine here because the secret carries the entropy;
// per-row salting would defeat the point of AEAD given GCM's per-message IV.
const SCRYPT_SALT = Buffer.from('drawing-mgmt-totp-v1', 'utf8');

let cachedKey: Buffer | null = null;

/**
 * Derive (and memoize) the 32-byte AES key. Throws if AUTH_SECRET is
 * missing or short — production deployments must set a real value.
 */
function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      '[crypto] AUTH_SECRET (>= 16 chars) is required for at-rest encryption',
    );
  }
  cachedKey = scryptSync(secret, SCRYPT_SALT, 32);
  return cachedKey;
}

/**
 * Encrypt a UTF-8 plaintext into the versioned envelope format described
 * above. Each call produces a fresh random IV; never reuse the output as
 * a "deterministic" id.
 */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('[crypto] encryptSecret: plaintext must be a non-empty string');
  }
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    KEY_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    enc.toString('base64url'),
  ].join(':');
}

/**
 * Decrypt a string previously produced by `encryptSecret`. Pre-R49 plaintext
 * rows (no `v1:` prefix) are returned as-is so verifyTotp keeps working
 * during the natural migration window. Throws on tampered ciphertext (GCM
 * auth tag mismatch) — callers should treat that as "unrecoverable secret".
 */
export function decryptSecret(blob: string): string {
  if (!isEncryptedSecret(blob)) {
    // Pre-R49 plaintext (or, defensively, an unexpected non-prefixed value).
    return blob;
  }
  const parts = blob.split(':');
  if (parts.length !== 4) {
    throw new Error('[crypto] decryptSecret: malformed ciphertext envelope');
  }
  const [ver, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  if (ver !== KEY_VERSION) {
    throw new Error(`[crypto] decryptSecret: unknown key version "${ver}"`);
  }
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  if (iv.length !== IV_LEN) {
    throw new Error('[crypto] decryptSecret: bad IV length');
  }
  if (tag.length !== TAG_LEN) {
    throw new Error('[crypto] decryptSecret: bad auth tag length');
  }
  const key = deriveKey();
  const dec = createDecipheriv(ALGO, key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(data), dec.final()]).toString('utf8');
}

/**
 * True iff the given value looks like an encrypted envelope (starts with
 * the current key-version prefix). Cheap syntactic check — does not
 * authenticate the ciphertext.
 *
 * Constant-time prefix comparison so nothing leaks "is this encrypted?"
 * timing across HTTP boundaries.
 */
export function isEncryptedSecret(blob: string | null | undefined): boolean {
  if (typeof blob !== 'string') return false;
  if (blob.length < KEY_PREFIX.length) return false;
  const head = Buffer.from(blob.slice(0, KEY_PREFIX.length), 'utf8');
  const want = Buffer.from(KEY_PREFIX, 'utf8');
  if (head.length !== want.length) return false;
  return timingSafeEqual(head, want);
}
