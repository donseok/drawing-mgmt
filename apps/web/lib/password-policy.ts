// R39 / A-4 — Password policy validation + expiry helper.
//
// Single source of truth for the rules consumed by:
//   - PATCH /api/v1/me/password           (user change)
//   - POST  /api/v1/admin/users           (admin create)
//   - POST  /api/v1/admin/users/:id/reset-password
//
// Rules:
//   1. Length ≥ 10 characters.
//   2. At least 3 of 4 character classes:
//        - lowercase letter
//        - uppercase letter
//        - digit
//        - special (printable non-alnum)
//   3. Must differ from the most recent two historical hashes
//      (`User.passwordPrev1Hash`, `User.passwordPrev2Hash`) AND the current
//      `passwordHash`. Verified via bcrypt.compare.
//
// Expiry:
//   - 90 days. `isPasswordExpired` is consumed by middleware to redirect
//     stale-password users to /change-password.
//
// API surface intentionally narrow (`validatePassword`, `isPasswordExpired`,
// `applyPasswordChange`) so future tightening (length raised, history depth
// expanded, denylist) lands in one file.

import bcrypt from 'bcryptjs';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;
/** Days. Exported so the FE can mirror the 'expires in N days' message. */
export const PASSWORD_EXPIRY_DAYS = 90;
const PASSWORD_EXPIRY_MS = PASSWORD_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

/** Stable error codes returned in the `details.errors` array on E_VALIDATION. */
export type PasswordPolicyError =
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_LOW_COMPLEXITY'
  | 'PASSWORD_REUSED';

export interface PasswordPolicyResult {
  ok: boolean;
  errors: PasswordPolicyError[];
}

/**
 * Synchronous portion of the policy check (length + complexity). The
 * history-reuse check requires bcrypt.compare and lives in
 * `validatePasswordWithHistory` below — split apart so a UI can render
 * "complexity OK" feedback live without firing the bcrypt round-trip.
 */
export function validatePassword(plain: string): PasswordPolicyResult {
  const errors: PasswordPolicyError[] = [];

  if (typeof plain !== 'string' || plain.length < PASSWORD_MIN_LENGTH) {
    errors.push('PASSWORD_TOO_SHORT');
  }
  if (typeof plain === 'string' && plain.length > PASSWORD_MAX_LENGTH) {
    errors.push('PASSWORD_TOO_LONG');
  }
  if (typeof plain === 'string' && countCharClasses(plain) < 3) {
    errors.push('PASSWORD_LOW_COMPLEXITY');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Full policy check including reuse against the supplied hash list.
 * `previousHashes` should be the deduped, non-empty entries of the user's
 * current `passwordHash`, `passwordPrev1Hash`, `passwordPrev2Hash`.
 */
export async function validatePasswordWithHistory(
  plain: string,
  previousHashes: ReadonlyArray<string | null | undefined>,
): Promise<PasswordPolicyResult> {
  const sync = validatePassword(plain);
  // If complexity already failed there's no upside in iterating bcrypt
  // (which is intentionally slow). Bail early — the FE re-submits anyway.
  if (!sync.ok) return sync;

  for (const hash of previousHashes) {
    if (!hash) continue;
    try {
      const match = await bcrypt.compare(plain, hash);
      if (match) {
        return { ok: false, errors: ['PASSWORD_REUSED'] };
      }
    } catch {
      // Malformed hash slot — skip rather than throw. (Real bcrypt errors
      // would be a developer bug, not a user-driven validation failure.)
    }
  }
  return { ok: true, errors: [] };
}

/** Count distinct character classes present in `plain` (max 4). */
function countCharClasses(plain: string): number {
  let count = 0;
  if (/[a-z]/.test(plain)) count++;
  if (/[A-Z]/.test(plain)) count++;
  if (/[0-9]/.test(plain)) count++;
  // printable non-alphanumeric / non-whitespace
  if (/[^A-Za-z0-9\s]/.test(plain)) count++;
  return count;
}

// ── Expiry ─────────────────────────────────────────────────────────────────

/**
 * Returns true when `passwordChangedAt` is older than PASSWORD_EXPIRY_DAYS.
 * Tolerant of null (treated as "needs change immediately") so accounts
 * provisioned by reset-password without bumping the column also bounce.
 */
export function isPasswordExpired(
  passwordChangedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!passwordChangedAt) return true;
  return now.getTime() - passwordChangedAt.getTime() > PASSWORD_EXPIRY_MS;
}

// ── Helpers consumed by route handlers ────────────────────────────────────
//
// Pure data transform — given the current password row state, produce the
// `data` payload to feed into `prisma.user.update` so historical hashes
// shift forward and `passwordChangedAt` bumps. Keeps the route handler
// free of column-shuffle logic.

export interface CurrentPasswordRow {
  passwordHash: string;
  passwordPrev1Hash: string | null;
  /** Currently unused but reserved for future deeper history. */
  passwordPrev2Hash: string | null;
}

export function buildPasswordChangeUpdate(
  current: CurrentPasswordRow,
  newHash: string,
  now: Date = new Date(),
): {
  passwordHash: string;
  passwordPrev1Hash: string | null;
  passwordPrev2Hash: string | null;
  passwordChangedAt: Date;
} {
  return {
    passwordHash: newHash,
    // Shift: prev1 → prev2, current → prev1.
    passwordPrev2Hash: current.passwordPrev1Hash,
    passwordPrev1Hash: current.passwordHash,
    passwordChangedAt: now,
  };
}
