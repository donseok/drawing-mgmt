-- =============================================================================
-- 0004_r19_lobby_reply.sql
--
-- R19 — recipient replies on Lobby packages. Adds the LobbyReply table + the
-- LobbyReplyDecision enum. Idempotent.
--
-- Apply with:
--   docker compose exec -T postgres \
--     psql -U drawmgmt -d drawmgmt < apps/web/prisma/migrations/manual/0004_r19_lobby_reply.sql
--
-- After running, regenerate the Prisma client:
--   pnpm -F web exec prisma generate
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LobbyReplyDecision') THEN
    CREATE TYPE "LobbyReplyDecision" AS ENUM (
      'COMMENT', 'APPROVE', 'REJECT', 'REVISE_REQUESTED'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "LobbyReply" (
  "id"        TEXT PRIMARY KEY,
  "lobbyId"   TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "comment"   TEXT NOT NULL,
  "decision"  "LobbyReplyDecision" NOT NULL DEFAULT 'COMMENT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LobbyReply_lobbyId_fkey"
    FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "LobbyReply_lobbyId_createdAt_idx"
  ON "LobbyReply"("lobbyId", "createdAt");

COMMIT;
