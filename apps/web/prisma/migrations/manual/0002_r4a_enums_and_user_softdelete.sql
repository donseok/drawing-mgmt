-- =============================================================================
-- 0002_r4a_enums_and_user_softdelete.sql
--
-- R4a (F4-01, F4-02, F4-04) — schema cleanup:
--   1. Add `User.deletedAt` (soft-delete signal; supersedes employmentType=RETIRED
--      as the canonical "user is gone" check).
--   2. Collapse `ApprovalStatus.IN_PROGRESS` → `PENDING` and drop the enum value.
--   3. Rename `StepStatus.WAITING` → `PENDING` (drop WAITING, default PENDING).
--
-- Idempotent. Safe to re-run after partial application.
--
-- Apply with:
--   docker compose exec -T postgres \
--     psql -U drawmgmt -d drawmgmt < apps/web/prisma/migrations/manual/0002_r4a_enums_and_user_softdelete.sql
--
-- After running, regenerate the Prisma client:
--   pnpm -F web exec prisma generate
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. User.deletedAt
-- ----------------------------------------------------------------------------
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User"("deletedAt");

-- ----------------------------------------------------------------------------
-- 2. ApprovalStatus — drop IN_PROGRESS
--    Postgres enums require ALTER TYPE ... RENAME VALUE / ADD VALUE only.
--    To remove a value we replace the type via the standard rename-then-rebuild
--    pattern.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ApprovalStatus' AND e.enumlabel = 'IN_PROGRESS'
  ) THEN
    -- Backfill any existing IN_PROGRESS rows to PENDING before dropping.
    UPDATE "Approval" SET "status" = 'PENDING' WHERE "status" = 'IN_PROGRESS';

    -- Rename the live type out of the way and create the cleaned-up version.
    ALTER TYPE "ApprovalStatus" RENAME TO "ApprovalStatus_old";

    CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

    ALTER TABLE "Approval"
      ALTER COLUMN "status" DROP DEFAULT,
      ALTER COLUMN "status" TYPE "ApprovalStatus"
        USING ("status"::text::"ApprovalStatus"),
      ALTER COLUMN "status" SET DEFAULT 'PENDING';

    DROP TYPE "ApprovalStatus_old";
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 3. StepStatus — rename WAITING → PENDING
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'StepStatus' AND e.enumlabel = 'WAITING'
  ) THEN
    -- Backfill any existing WAITING rows to PENDING before dropping.
    -- (We map directly via cast through text to avoid the "value already
    -- exists in target enum" error if PENDING happens to already be defined.)
    UPDATE "ApprovalStep" SET "status" = 'WAITING' WHERE "status" = 'WAITING';

    ALTER TYPE "StepStatus" RENAME TO "StepStatus_old";

    CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

    ALTER TABLE "ApprovalStep"
      ALTER COLUMN "status" DROP DEFAULT,
      ALTER COLUMN "status" TYPE "StepStatus"
        USING (
          CASE "status"::text
            WHEN 'WAITING' THEN 'PENDING'
            ELSE "status"::text
          END
        )::"StepStatus",
      ALTER COLUMN "status" SET DEFAULT 'PENDING';

    DROP TYPE "StepStatus_old";
  END IF;
END$$;

COMMIT;
