-- =============================================================================
-- 0015_r41_pdf_extract_status — A: PDF body-extract lifecycle on Attachment
--
-- R40 only tracked a NULL/non-NULL `contentText` to know whether the worker
-- had populated PDF body text yet, but that representation can't distinguish:
--   * "never enqueued" (no PDF artifact ever existed)
--   * "enqueued, in-flight"
--   * "ran, returned empty text" (legitimate; some PDFs are pure raster)
--   * "ran, hit an error" (e.g. encrypted PDF, malformed file)
-- /admin/pdf-extracts (R41) needs that distinction so an admin can find
-- failed rows and retry them. This migration adds the enum + three columns
-- + an index to back the listing query, and backfills any row that already
-- has contentText populated to DONE so the admin page doesn't see a giant
-- pile of phantom PENDINGs on day one.
--
-- Safe to re-run on partially-applied DBs (idempotent + transactional).
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- PdfExtractStatus enum
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PdfExtractStatus') THEN
        CREATE TYPE "PdfExtractStatus" AS ENUM (
            'PENDING',
            'EXTRACTING',
            'DONE',
            'FAILED',
            'SKIPPED'
        );
    END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────
-- Attachment columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "Attachment"
    ADD COLUMN IF NOT EXISTS "pdfExtractStatus" "PdfExtractStatus"
        NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS "pdfExtractAt"     TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "pdfExtractError"  TEXT;

-- ─────────────────────────────────────────────────────────────
-- Backfill: rows that already have extracted text predate this migration,
-- so they're effectively DONE. Without this they'd show up as PENDING in
-- /admin/pdf-extracts forever (the worker only re-enqueues from the
-- conversion DONE path, not from a status sweep).
--
-- Restrict to PENDING so re-runs of this migration don't clobber any row
-- that's been moved to FAILED/SKIPPED in the meantime.
-- ─────────────────────────────────────────────────────────────
UPDATE "Attachment"
   SET "pdfExtractStatus" = 'DONE'
 WHERE "contentText" IS NOT NULL
   AND "pdfExtractStatus" = 'PENDING';

-- ─────────────────────────────────────────────────────────────
-- Status index — backs /admin/pdf-extracts listing filter + groupBy.
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Attachment_pdfExtractStatus_idx"
    ON "Attachment" ("pdfExtractStatus");

COMMIT;
