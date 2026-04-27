-- =============================================================================
-- 0009_r35_user_notify_email — N-1 mail channel toggle
--
-- Adds `User.notifyByEmail` (Boolean, default TRUE). Read by
-- `enqueueNotification` (apps/web/lib/notifications.ts) when deciding whether
-- to push a job onto the BullMQ `mail` queue. The global `MAIL_ENABLED` env
-- gate still wins — this column is the user-facing opt-out.
--
-- Default TRUE so the upgrade preserves parity with the previous in-app-only
-- behaviour (no surprise email blast either: that requires `MAIL_ENABLED=1`
-- + populated SMTP_*).
--
-- Idempotent + transactional. Safe to re-run on partially-applied DBs.
-- =============================================================================

BEGIN;

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "notifyByEmail" BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
