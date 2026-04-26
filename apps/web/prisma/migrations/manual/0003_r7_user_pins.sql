-- =============================================================================
-- 0003_r7_user_pins.sql
--
-- R7 part A — workspace personalization. Adds two pin tables so users can
-- bookmark folders / objects shown in the home "핀 고정" panel and the
-- search sidebar's "즐겨찾기" section.
--
-- Idempotent. Safe to re-run.
--
-- Apply with:
--   docker compose exec -T postgres \
--     psql -U drawmgmt -d drawmgmt < apps/web/prisma/migrations/manual/0003_r7_user_pins.sql
--
-- After running, regenerate the Prisma client:
--   pnpm -F web exec prisma generate
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- UserFolderPin
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "UserFolderPin" (
  "id"         TEXT PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "folderId"   TEXT NOT NULL,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserFolderPin_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UserFolderPin_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserFolderPin_userId_folderId_key"
  ON "UserFolderPin"("userId", "folderId");
CREATE INDEX IF NOT EXISTS "UserFolderPin_userId_sortOrder_idx"
  ON "UserFolderPin"("userId", "sortOrder");

-- ----------------------------------------------------------------------------
-- UserObjectPin
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "UserObjectPin" (
  "id"         TEXT PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "objectId"   TEXT NOT NULL,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserObjectPin_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UserObjectPin_objectId_fkey"
    FOREIGN KEY ("objectId") REFERENCES "ObjectEntity"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserObjectPin_userId_objectId_key"
  ON "UserObjectPin"("userId", "objectId");
CREATE INDEX IF NOT EXISTS "UserObjectPin_userId_sortOrder_idx"
  ON "UserObjectPin"("userId", "sortOrder");

COMMIT;
