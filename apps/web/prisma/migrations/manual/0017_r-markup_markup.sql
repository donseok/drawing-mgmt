-- R-MARKUP / V-6 — Persistent measurement markups for attachments.
--
-- One row per saved markup. The viewer's measurement state used to live
-- in memory only; this table makes it survive a page refresh and lets
-- users share their work with the team.
--
-- Shape (cf. packages/shared/src/markup.ts):
--   - payload :: jsonb { schemaVersion: 1, mode: 'pdf'|'dxf',
--                        unitLabel, measurements: Measurement[] }
--   - isShared = false → private to ownerId (default).
--   - isShared = true  → any VIEWer on the attachment can load it.
--
-- Indexes:
--   - (attachmentId, isShared) → primary list query (mine + shared).
--   - (attachmentId, ownerId)  → owner-side filter (PATCH/DELETE auth).
--   - (ownerId)                → admin tooling: "all markups by user X".
--
-- Cascade choices match Prisma:
--   - attachment delete → wipe its markups (no orphan rows on detached file).
--   - user delete       → wipe their markups (V-6 step 1 simplification;
--                         preserving retired-user shared markups is a
--                         later round, not this one).
--
-- Idempotent + transactional so re-running on a partially-applied DB
-- never poisons the schema.

BEGIN;

CREATE TABLE IF NOT EXISTS "Markup" (
  "id"           TEXT PRIMARY KEY,
  "attachmentId" TEXT NOT NULL,
  "ownerId"      TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "payload"      JSONB NOT NULL,
  "isShared"     BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Markup_attachmentId_fkey" FOREIGN KEY ("attachmentId")
    REFERENCES "Attachment" ("id") ON DELETE CASCADE,
  CONSTRAINT "Markup_ownerId_fkey" FOREIGN KEY ("ownerId")
    REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Markup_attachmentId_isShared_idx"
  ON "Markup" ("attachmentId", "isShared");
CREATE INDEX IF NOT EXISTS "Markup_attachmentId_ownerId_idx"
  ON "Markup" ("attachmentId", "ownerId");
CREATE INDEX IF NOT EXISTS "Markup_ownerId_idx"
  ON "Markup" ("ownerId");

COMMIT;
