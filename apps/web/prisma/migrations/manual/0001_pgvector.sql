-- =============================================================================
-- 0001_pgvector.sql — manual post-migration SQL
-- Run AFTER `prisma migrate dev` to enable Postgres extensions and FTS indexes
-- that Prisma cannot manage natively.
--
-- Idempotent: safe to re-run. Used in dev (docker compose) and prod.
--
-- Apply with:
--   docker compose exec -T postgres \
--     psql -U drawmgmt -d drawmgmt < apps/web/prisma/migrations/manual/0001_pgvector.sql
--
-- See: docs/TRD.md §3.3, §3.4, §14.7
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- ManualChunk.embedding — vector column + ivfflat ANN index
-- Prisma's `Unsupported("vector(1536)")` declares the column type, but the
-- production image (pgvector/pgvector:pg16) needs the column actually created
-- here so we can index it. ALTER ... IF NOT EXISTS is idempotent.
-- ----------------------------------------------------------------------------
ALTER TABLE "ManualChunk"
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- ivfflat with cosine ops; lists=100 is a reasonable default for ≤100k rows.
-- The index can only be built when there's at least 1 row; CREATE INDEX
-- IF NOT EXISTS is safe even when empty (it just creates a meta entry).
CREATE INDEX IF NOT EXISTS manual_chunk_emb_idx
  ON "ManualChunk"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ----------------------------------------------------------------------------
-- Trigram GIN indexes for Korean partial-match full-text search
-- (TRD §3.4 — pg_trgm + GIN until mecab-ko / textsearch_ko adopted)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS object_entity_name_trgm_idx
  ON "ObjectEntity"
  USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS object_entity_description_trgm_idx
  ON "ObjectEntity"
  USING GIN (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS object_entity_number_trgm_idx
  ON "ObjectEntity"
  USING GIN (number gin_trgm_ops);
