# @drawing-mgmt/migration

TeamPlus → drawing-mgmt ETL skeleton (WBS 4.3).

The real TeamPlus DB schema is going to be handed over by ops; until then
this package runs end-to-end against an in-memory `MockSource` (50 mock
drawings + 10 users + 5 folders) so the pipeline, transform layer,
checksum logic, and report shapes can be exercised in CI without a live
DB.

## Commands

```bash
# Dry run — never touches DB or disk. Produces a JSON report.
pnpm -F @drawing-mgmt/migration dry-run

# Sample mode — only process the first N drawings.
pnpm -F @drawing-mgmt/migration dry-run --sample 10

# Verify — re-runs the source iterator and checks the loader's id maps.
pnpm -F @drawing-mgmt/migration verify --sample 50

# Rehearsal — dry-run + verify, side by side. Used before each real-run
# rehearsal (WBS 4.3.6).
pnpm -F @drawing-mgmt/migration rehearsal

# Full run — disabled until the target schema gets externalId columns
# (see `src/target/prisma-loader.ts` TODO at the bottom of the file).
pnpm -F @drawing-mgmt/migration full
```

Reports land in `MIGRATION_REPORT_DIR` (default
`./migration-reports/migration-<iso>.json` and
`./migration-reports/verify-<iso>.json`).

## Environment

| Variable                      | Purpose                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| `MIGRATION_SOURCE_DB_URL`     | TeamPlus DB URL (used by `TeamPlusSource` once implemented)                 |
| `MIGRATION_SOURCE_FILES_ROOT` | NAS root that holds TeamPlus attachment bodies                              |
| `MIGRATION_TARGET_DB_URL`     | drawing-mgmt DB URL — defaults to `DATABASE_URL`                            |
| `MIGRATION_REPORT_DIR`        | Where JSON reports go (default `./migration-reports`)                       |
| `MIGRATION_DRY_RUN=1`         | Forces `full` to coerce to `dry-run`. CI uses this to be safe by default.   |
| `FILE_STORAGE_ROOT`           | Where attachment bodies are written by `full` (mirrors the web app's root). |

## Architecture

```
                     ┌────────────────┐
TeamPlus DB / NAS →  │  Source        │  ← contract: src/source/types.ts
                     │  (mock | live) │
                     └───────┬────────┘
                             │ AsyncIterable
                             ▼
                     ┌────────────────┐
                     │  Transform     │  ← pure functions, no IO
                     │ (per entity)   │     src/transform/*.ts
                     └───────┬────────┘
                             │
                             ▼
                     ┌────────────────┐
drawing-mgmt DB +    │  Loader        │  ← Prisma upserts + file copy
FILE_STORAGE_ROOT  → │  (dry | live)  │     src/target/prisma-loader.ts
                     └───────┬────────┘
                             │
                             ▼
                     ┌────────────────┐
BullMQ / Redis     ← │ ConversionQ    │  ← enqueues per master attachment
                     └────────────────┘     src/target/conversion-queue.ts
```

The `Pipeline` in `src/pipeline.ts` is the orchestrator that walks the
seven dependency-ordered phases (Org → User → Folder → Class → Object →
Revision → Version → Attachment) and emits a `MigrationReport`.

## Adding the real TeamPlus adapter

When ops hands over the schema:

1. Decide on a driver. Postgres? `pg`. SQL Server? `mssql`. Add it to
   `package.json` and run `pnpm install --no-frozen-lockfile` once to
   refresh the lock.
2. Open `src/source/teamplus.ts` and replace each `throw new Error('not
   implemented')` with a streaming cursor query that yields the
   `TeamPlus*` row shapes already defined in `src/source/types.ts`. Keep
   the *external id* columns intact — the transform layer uses them for
   FK relinking.
3. Run `pnpm -F @drawing-mgmt/migration test` — the existing unit tests
   cover the transform layer; you'll add an integration test that points
   at a sandbox copy of the TeamPlus DB.
4. Add `externalId` columns to the drawing-mgmt schema (User,
   Organization, Folder, ObjectEntity, Revision, Version, Attachment).
   Two-step migration: nullable column → backfill at run time → flip
   to NOT NULL after the live run.
5. Flip `loader.dryRun=false` paths from `throw` to actual Prisma
   `upsert` calls. Idempotency is the whole reason the externalId
   columns exist.

## 50-row verification procedure (WBS 4.3.4)

1. `pnpm -F @drawing-mgmt/migration dry-run --sample 50`
2. `pnpm -F @drawing-mgmt/migration verify --sample 50`
3. Eyeball the JSON report's `mismatched` count + the per-row
   `mismatches` array.
4. If anything mismatched: investigate the transform helpers in
   `src/transform/`, then reschedule the rehearsal.

The pipeline is idempotent (id maps are keyed on externalId, file copy
re-checksums and overwrites), so step 1+2 are safe to repeat any number
of times.
