# Manual Migrations (Deprecated)

The SQL files previously in this directory have been incorporated into the
Prisma Migrate baseline migration (`20260426000000_init/migration.sql`).

- pgvector extension + ManualChunk embedding column/index
- pg_trgm GIN indexes for Korean full-text search
- Enum additions and schema changes from R4a, R7, R19

All future schema changes should use `prisma migrate dev --name <slug>`.
