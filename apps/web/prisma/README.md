# Prisma — DB Operations Guide

This directory holds the Prisma schema, the auto-generated migrations, the
manual SQL post-migration (`migrations/manual/`), and the seed script.

The data model is defined in `schema.prisma` and is documented in
[`docs/TRD.md` §3](../../../docs/TRD.md). DO NOT modify the schema without
coordinating with the project lead — the schema is the contract every other
package relies on.

## Prerequisites

- Docker Desktop (or any local Postgres 16 with pgvector and pgcrypto)
- Node.js ≥ 20, pnpm ≥ 9
- `.env` (or `.env.local`) at `apps/web/` containing at minimum:

  ```dotenv
  DATABASE_URL="postgresql://drawmgmt:drawmgmt@localhost:5432/drawmgmt?schema=public"
  ```

## 1. Bring up Postgres + Redis

From the repo root:

```bash
pnpm docker:up
# or:  docker compose up -d
```

This starts:

- `drawmgmt-postgres` (`pgvector/pgvector:pg16`) on `localhost:5432`
- `drawmgmt-redis` (`redis:7-alpine`) on `localhost:6379`

Stop with `pnpm docker:down`.

## 2. Generate the Prisma client

```bash
pnpm db:generate
# wraps:  pnpm --filter @drawing-mgmt/web prisma generate
```

Run this any time `schema.prisma` changes.

## 3. Apply migrations

```bash
pnpm db:migrate           # dev:  prisma migrate dev
# or for non-dev environments:
pnpm --filter @drawing-mgmt/web exec prisma migrate deploy
```

`prisma migrate dev` will create/update tables from `schema.prisma`. It will
NOT create the `vector` extension or the trigram GIN indexes — those are
managed by the manual SQL below.

## 4. Apply the manual pgvector + trgm SQL

```bash
docker compose exec -T postgres \
  psql -U drawmgmt -d drawmgmt \
  < apps/web/prisma/migrations/manual/0001_pgvector.sql
```

This is idempotent (uses `IF NOT EXISTS` everywhere) so it's safe to re-run
after every `prisma migrate`. It performs:

- `CREATE EXTENSION` for `vector`, `pgcrypto`, `pg_trgm`
- Adds the `embedding vector(1536)` column to `ManualChunk`
- Builds an `ivfflat` ANN index on the embedding (cosine ops, lists=100)
- Builds three GIN trigram indexes on `ObjectEntity` (`name`, `description`,
  `number`) for partial-match Korean search per TRD §3.4

## 5. Seed

```bash
pnpm db:seed
# wraps:  tsx prisma/seed.ts
```

Idempotent — every write is `upsert`-keyed. See `seed.ts` header for the
catalogue of seeded users / orgs / classes / folders / number rules / sample
objects / manual chunks. Default credentials:

| Username   | Password      | Role         |
| ---------- | ------------- | ------------ |
| `admin`    | `admin123!`   | SUPER_ADMIN  |
| `manager`  | `manager123!` | ADMIN        |
| `kim`      | `kim123!`     | USER         |
| `park`     | `park123!`    | USER         |
| `lee`      | `lee123!`     | USER         |
| `partner1` | `partner123!` | PARTNER      |

## 6. Inspect

```bash
pnpm db:studio   # opens Prisma Studio on http://localhost:5555
```

## End-to-end first-run sequence

```bash
pnpm docker:up                                    # 1. Postgres + Redis
pnpm db:generate                                  # 2. generate client
pnpm db:migrate                                   # 3. apply schema migrations
docker compose exec -T postgres psql -U drawmgmt -d drawmgmt \
  < apps/web/prisma/migrations/manual/0001_pgvector.sql  # 4. extensions + GIN
pnpm db:seed                                      # 5. seed
```

## Troubleshooting

- **`type "vector" does not exist`** — you skipped step 4 above, or the
  extension isn't installed in your Postgres image. The `pgvector/pgvector:pg16`
  image used in `docker-compose.yml` has it pre-built.
- **Sequence collisions on bulk register** — Phase-1 number generation uses
  `MAX(number)+1` per (folderCode, year). Wrap registrations in
  `prisma.$transaction` with serializable isolation, or move to a real
  sequence table in Phase 2 (`apps/web/lib/db-helpers.ts` documents this).
- **Seed re-run wipes nothing** — by design. To start from scratch, drop the
  volume: `pnpm docker:down && docker volume rm drawing-mgmt_drawmgmt_db`.
