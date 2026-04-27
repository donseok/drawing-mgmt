-- =============================================================================
-- 0010_r36_virus_scan — V-INF-3 ClamAV scan lifecycle on Attachment
--
-- Adds three columns + an index on `Attachment` plus a new `VirusScanStatus`
-- enum used by the BullMQ `virus-scan` queue worker.
--
-- Default `virusScanStatus = PENDING` so the upgrade puts every existing row
-- through the new pipeline lazily — backfill is optional (a follow-up admin
-- script can enqueue scans for the legacy rows). The download/preview/print/
-- thumbnail guards skip the block on PENDING so existing files keep serving
-- until the worker has had a chance to scan them; only INFECTED is blocked.
--
-- Idempotent + transactional. Safe to re-run on partially-applied DBs.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- VirusScanStatus enum
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VirusScanStatus') THEN
        CREATE TYPE "VirusScanStatus" AS ENUM (
            'PENDING',
            'SCANNING',
            'CLEAN',
            'INFECTED',
            'SKIPPED',
            'FAILED'
        );
    END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────
-- Attachment columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "Attachment"
    ADD COLUMN IF NOT EXISTS "virusScanStatus" "VirusScanStatus"
        NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS "virusScanSig"    TEXT,
    ADD COLUMN IF NOT EXISTS "virusScanAt"     TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────
-- Status index (used by /admin/scans listing + INFECTED count badge)
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Attachment_virusScanStatus_idx"
    ON "Attachment" ("virusScanStatus");

COMMIT;
