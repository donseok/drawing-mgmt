-- =============================================================================
-- 0008_r33_backup_keycloak — D-5 backup history + A-1 Keycloak subject id
--
-- Two pieces:
--
-- (1) Backup model + BackupKind / BackupStatus enums (D-5)
--     Tracks every backup attempt (postgres dump or files tar). Rows are
--     written by the worker (apps/worker) and listed/streamed by the admin
--     endpoints under /api/v1/admin/backups.
--
-- (2) User.keycloakSub (A-1)
--     OIDC subject identifier — populated on first SSO login by the
--     `signIn` callback in apps/web/auth.ts so the user row stays stable
--     across username/email rewrites.
--
-- Idempotent + transactional. Safe to re-run on partially-applied DBs.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Part 1 — BackupKind / BackupStatus enums + Backup table
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BackupKind') THEN
        CREATE TYPE "BackupKind" AS ENUM (
            'POSTGRES',
            'FILES'
        );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BackupStatus') THEN
        CREATE TYPE "BackupStatus" AS ENUM (
            'RUNNING',
            'DONE',
            'FAILED'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "Backup" (
    "id"           TEXT NOT NULL,
    "kind"         "BackupKind"   NOT NULL,
    "status"       "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "storagePath"  TEXT,
    "sizeBytes"    BIGINT,
    "errorMessage" TEXT,
    "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt"   TIMESTAMP(3),

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Backup_kind_startedAt_idx"
    ON "Backup" ("kind", "startedAt");
CREATE INDEX IF NOT EXISTS "Backup_status_idx"
    ON "Backup" ("status");

-- ─────────────────────────────────────────────────────────────
-- Part 2 — User.keycloakSub
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "keycloakSub" TEXT;

-- Unique index — `@unique` on a nullable column maps to a regular UNIQUE
-- constraint in Postgres which already permits multiple NULLs (one per row).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_indexes
        WHERE  schemaname = 'public'
          AND  indexname  = 'User_keycloakSub_key'
    ) THEN
        CREATE UNIQUE INDEX "User_keycloakSub_key"
            ON "User" ("keycloakSub");
    END IF;
END
$$;

COMMIT;
