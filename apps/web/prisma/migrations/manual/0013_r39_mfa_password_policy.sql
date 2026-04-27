-- =============================================================================
-- 0013_r39_mfa_password_policy — A-3 MFA TOTP + A-4 password policy
--
-- Extends "User" with two orthogonal feature columns sets:
--
--   A-3 (TOTP MFA):
--     - totpSecret         TEXT          base32-encoded TOTP secret. Populated
--                                        on /enroll, cleared on /disable.
--                                        Nullable; non-MFA users keep NULL.
--                                        (Encrypt-at-rest is a follow-up — for
--                                        now plaintext, gated by the network
--                                        boundary and DB ACLs.)
--     - totpEnabledAt      TIMESTAMP     Source of truth for "MFA is on".
--                                        Null while enrolled-but-unconfirmed
--                                        (the user can still complete /confirm
--                                        or /disable).
--     - recoveryCodesHash  TEXT[]        bcrypt-hashed 1-time recovery codes.
--                                        Default empty array. Populated once
--                                        on /confirm; entries are removed as
--                                        the user consumes them via /verify.
--
--   A-4 (password policy):
--     - passwordChangedAt  TIMESTAMP NOT NULL  90-day expiry source. Default
--                                              `now()` so newly-INSERTed users
--                                              and existing rows (backfilled)
--                                              do not immediately bounce to
--                                              /change-password. Admin
--                                              `expire-password` flips this
--                                              to epoch 0 to force-rotate.
--     - passwordPrev1Hash  TEXT          Most recent historical bcrypt hash.
--     - passwordPrev2Hash  TEXT          Two-back historical bcrypt hash.
--                                        Together they back the
--                                        "no re-use of last 3 passwords"
--                                        rule on PATCH /me/password.
--
-- Backfill semantics for `passwordChangedAt`:
--
--   The column is NOT NULL with DEFAULT now(); Postgres applies the default
--   to existing rows when the column is added in this same statement, so all
--   pre-migration users get a timestamp ≈ migration time. That is the
--   correct semantics for an opt-in policy roll-out (not "everyone is
--   instantly expired").
--
-- Idempotent + transactional. Safe to re-run on partially-applied DBs.
-- =============================================================================

BEGIN;

-- ── A-3 MFA columns ────────────────────────────────────────────────────────
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "totpSecret"        TEXT;

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "totpEnabledAt"     TIMESTAMP(3);

-- PostgreSQL TEXT[] with default. `@default([])` on Prisma side maps cleanly
-- to `DEFAULT ARRAY[]::TEXT[]`. NOT NULL so callers can always treat the
-- column as a set without a coalesce.
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "recoveryCodesHash" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ── A-4 password policy columns ────────────────────────────────────────────
-- NOT NULL with default — see header comment for backfill semantics.
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT now();

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "passwordPrev1Hash" TEXT;

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "passwordPrev2Hash" TEXT;

COMMIT;
