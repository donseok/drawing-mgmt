-- =============================================================================
-- 0011_r37_user_saml — A-2 SAML SSO: User.samlSub
--
-- Adds a stable SAML 2.0 NameID column to the User model so that SAML SSO
-- logins can map back to a deterministic Postgres row even if HR rewrites
-- the username/email at the IdP.
--
-- Mirrors the Keycloak/OIDC linkage introduced in 0008_r33 (User.keycloakSub).
-- The two columns are independent — a single user could theoretically have
-- both populated if the org migrates between IdPs, but in practice only one
-- SSO path is wired at a time (gated by KEYCLOAK_ENABLED / SAML_ENABLED).
--
-- Idempotent + transactional. Safe to re-run on partially-applied DBs.
-- =============================================================================

BEGIN;

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "samlSub" TEXT;

-- Unique index — `@unique` on a nullable column maps to a regular UNIQUE
-- constraint in Postgres which already permits multiple NULLs (one per row).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_indexes
        WHERE  schemaname = 'public'
          AND  indexname  = 'User_samlSub_key'
    ) THEN
        CREATE UNIQUE INDEX "User_samlSub_key"
            ON "User" ("samlSub");
    END IF;
END
$$;

COMMIT;
