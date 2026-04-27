-- =============================================================================
-- 0014_r40_pdf_content_search — S-1 PDF body full-text search
--
-- Adds two columns + one index to the existing "Attachment" table so we can
-- query attachments by extracted PDF body text:
--
--   - content_text  TEXT
--       Raw extracted body text written by the `pdf-extract` worker
--       (apps/worker/src/pdf-extract.ts) after a successful PDF generation.
--       Always nullable — pre-R40 rows, non-PDF attachments, and rows that
--       failed extraction stay NULL. The application treats NULL as "no
--       content searchable yet" rather than "no content"; the search query
--       just won't match those rows.
--
--   - content_tsv   tsvector  GENERATED ALWAYS AS (...) STORED
--       Postgres-side derived tsvector built from `content_text`. Stored so
--       reads are O(1) and the GIN index can be backed without a custom
--       trigger. We use the `'simple'` dictionary (no stemming, no stop-word
--       removal) because:
--         (a) drawing PDFs are short, mostly Korean + part numbers — stemming
--             buys little and pulls in English stop-words that throw away
--             real content like "AS" / "OF".
--         (b) the `simple` config still lower-cases + tokenizes on whitespace,
--             which is all we need for the existing trgm UI behaviour.
--       Switching dictionaries later is a follow-up migration that only
--       touches this column's expression + the index DDL.
--
--   - idx_attachment_content_tsv  GIN(content_tsv)
--       The actual search index. GIN is the documented choice for tsvector
--       in pg-docs §12.2.2; it pays for build time with O(log N) lookups
--       on rare lexemes which is exactly the search-page workload.
--
-- The route handler (`apps/web/app/api/v1/search/route.ts`) issues raw
-- `to_tsquery('simple', $1) @@ content_tsv` queries and `ts_headline(...)`
-- for snippet extraction. Prisma can't model the tsvector column so the
-- corresponding `Attachment.contentText` field in schema.prisma is the only
-- thing the ORM knows about; the index + tsvector are reach-in-from-SQL.
--
-- Idempotent + transactional. Safe to re-run on partially-applied DBs
-- (CONCURRENTLY would be nicer for the index but it can't run in a
-- transaction; the table is small at this stage so a normal CREATE INDEX
-- inside BEGIN is the right trade-off).
-- =============================================================================

BEGIN;

-- ── Body text column ──────────────────────────────────────────────────────
ALTER TABLE "Attachment"
    ADD COLUMN IF NOT EXISTS "contentText" TEXT;

-- ── Generated tsvector ────────────────────────────────────────────────────
-- Generated columns can't be added IF NOT EXISTS conditionally on the
-- expression in older Postgres releases, so we guard with an explicit
-- catalog check. Postgres 16 (project minimum) supports the GENERATED
-- ALWAYS AS ... STORED form unconditionally.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_name = 'Attachment'
           AND column_name = 'content_tsv'
    ) THEN
        ALTER TABLE "Attachment"
            ADD COLUMN "content_tsv" tsvector
            GENERATED ALWAYS AS (
                to_tsvector('simple', coalesce("contentText", ''))
            ) STORED;
    END IF;
END$$;

-- ── GIN index for full-text search ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_attachment_content_tsv"
    ON "Attachment"
    USING GIN ("content_tsv");

COMMIT;
