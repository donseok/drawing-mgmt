-- =============================================================================
-- 0006_r29_conversion_thumbnail — ConversionJob persistent artifact paths
--
-- R29 V-INF-6 introduces auto-thumbnail generation in the conversion worker
-- and a streaming endpoint that serves the PNG. Until now the worker only
-- returned paths in the BullMQ result envelope; we never persisted them on
-- the ConversionJob row, so any read path (admin UI, thumbnail endpoint)
-- had to re-derive the on-disk layout.
--
-- This migration adds two nullable columns:
--   * dxfPath        — absolute path to the produced preview.dxf
--   * thumbnailPath  — absolute path to the produced thumbnail.png
--
-- Both are nullable: jobs that did not (or could not) produce the artifact
-- simply leave the field empty. Idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE "ConversionJob"
  ADD COLUMN IF NOT EXISTS "dxfPath"       TEXT,
  ADD COLUMN IF NOT EXISTS "thumbnailPath" TEXT;
