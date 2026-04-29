-- R-AUDIT-TREND — SecurityAuditSnapshot table.
--
-- Persists daily `pnpm audit --json` results so the admin security page
-- can plot a trend over time (FIND-016 mitigation). One row per snapshot;
-- the worker (apps/worker/src/security-audit-worker.ts) writes on a cron
-- repeatable + a SUPER_ADMIN-only POST endpoint can trigger ad-hoc rows.
--
-- Idempotent + transactional: safe to apply on a DB that already has the
-- table (running this twice is a no-op). Aligns with the rest of the
-- manual/* migrations which `prisma migrate deploy` walks alphabetically.

BEGIN;

CREATE TABLE IF NOT EXISTS "SecurityAuditSnapshot" (
  "id"             TEXT PRIMARY KEY,
  "takenAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "critical"       INTEGER NOT NULL DEFAULT 0,
  "high"           INTEGER NOT NULL DEFAULT 0,
  "moderate"       INTEGER NOT NULL DEFAULT 0,
  "low"            INTEGER NOT NULL DEFAULT 0,
  "total"          INTEGER NOT NULL DEFAULT 0,
  "source"         TEXT NOT NULL DEFAULT 'cron',
  "durationMs"     INTEGER,
  "advisoriesJson" JSONB
);

CREATE INDEX IF NOT EXISTS "SecurityAuditSnapshot_takenAt_idx"
  ON "SecurityAuditSnapshot" ("takenAt");

CREATE INDEX IF NOT EXISTS "SecurityAuditSnapshot_source_takenAt_idx"
  ON "SecurityAuditSnapshot" ("source", "takenAt");

COMMIT;
