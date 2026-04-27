-- R29 / N-1 — first-class Notification table.
--
-- Replaces the previous ActivityLog-derived synthesis used by the bell badge
-- and notification panel. Notifications are written in the same Prisma
-- transaction as the originating mutation (logActivity hotspots), so the
-- table is the system of record for "did the user see this".
--
-- Idempotent + transactional: safe to re-run on partially-applied DBs.
-- The Prisma migrate baseline lives in `20260426000000_init/`; this manual
-- file is hand-applied (`psql -f`) until we cut a fresh `prisma migrate dev`
-- baseline. See `migrations/manual/README.md` for context.

BEGIN;

-- CreateTable: Notification
CREATE TABLE IF NOT EXISTS "Notification" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "type"      TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "body"      TEXT,
    "objectId"  TEXT,
    "metadata"  JSONB,
    "readAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Indexes used by the feed (recent first) and the unread-count badge.
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx"
    ON "Notification" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx"
    ON "Notification" ("userId", "readAt");

-- FK to User. Cascade so wiping a user removes their notifications too.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint
        WHERE  conname = 'Notification_userId_fkey'
    ) THEN
        ALTER TABLE "Notification"
            ADD CONSTRAINT "Notification_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE;
    END IF;
END
$$;

COMMIT;
