-- =============================================================================
-- 0007_r31_upload — V-INF-2 chunked upload + P-1 print pipeline reuse
--
-- This migration adds two pieces:
--
-- (1) Upload model + UploadStatus enum (V-INF-2)
--     New table tracking in-progress chunked upload sessions. Each row is
--     paired with a temp file at `<UPLOAD_TMP_ROOT>/<id>.bin`; finalize()
--     moves the bytes into the regular attachment storage and flips the
--     row to COMPLETED.
--
-- (2) ConversionJob.metadata + ConversionJob.pdfPath (P-1)
--     Print uses the existing ConversionJob queue with metadata.kind='PRINT'
--     plus a stable pdfPath column that the status endpoint reads. Reusing
--     ConversionJob keeps the lifecycle UI consistent (admin already lists
--     and retries these rows).
--
-- Idempotent + transactional. Safe to re-run on partially-applied DBs.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Part 1 — UploadStatus enum + Upload table
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UploadStatus') THEN
        CREATE TYPE "UploadStatus" AS ENUM (
            'PENDING',
            'IN_PROGRESS',
            'COMPLETED',
            'FAILED',
            'EXPIRED'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "Upload" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "filename"      TEXT NOT NULL,
    "mimeType"      TEXT NOT NULL,
    "totalBytes"    BIGINT NOT NULL,
    "uploadedBytes" BIGINT NOT NULL DEFAULT 0,
    "storagePath"   TEXT NOT NULL,
    "status"        "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage"  TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Upload_userId_status_idx"
    ON "Upload" ("userId", "status");
CREATE INDEX IF NOT EXISTS "Upload_expiresAt_idx"
    ON "Upload" ("expiresAt");

-- FK Upload.userId → User.id (CASCADE so retired users don't leave dangling rows).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint
        WHERE  conname = 'Upload_userId_fkey'
    ) THEN
        ALTER TABLE "Upload"
            ADD CONSTRAINT "Upload_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE;
    END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────
-- Part 2 — ConversionJob.metadata + ConversionJob.pdfPath
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "ConversionJob"
    ADD COLUMN IF NOT EXISTS "metadata" JSONB,
    ADD COLUMN IF NOT EXISTS "pdfPath"  TEXT;

COMMIT;
