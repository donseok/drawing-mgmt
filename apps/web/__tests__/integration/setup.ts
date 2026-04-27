// Integration test setup — runs once per test file (vitest globalSetup is
// per-process, but we want per-file isolation so each file can mutate the
// DB without leaking state).
//
// Strategy:
//   - DATABASE_URL must point at a dedicated test database (default
//     `postgresql://drawing:drawing@localhost:5433/drawing_test`). The CI
//     job spins up a service container; locally you can run a test DB
//     via `docker-compose.test.yml` (or just point at any disposable DB).
//   - On import we run `prisma migrate deploy` once per process so the
//     schema matches HEAD. After that, each test file calls `resetDb()`
//     in beforeEach to TRUNCATE the working tables.
//   - A small seed (1 super-admin + 1 user + 1 organization + 1 folder
//     + 1 class) is provided for tests that need a logged-in actor.
//
// Why TRUNCATE rather than `prisma migrate reset`:
//   migrate reset runs migrate deploy + seed every time → seconds per test.
//   TRUNCATE on the foreign-key-respecting subset of tables is sub-second.
//
// IMPORTANT: this module never runs against the dev/prod DATABASE_URL — it
// asserts the URL has `_test` in it before connecting. CI sets the URL via
// service container env; locally you opt in by exporting it.

import { execSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const TEST_DB_GUARD = /_test(\b|$|[?])/i;

/** Sentinel ids used by helpers + tests. */
export const TEST_IDS = {
  superAdmin: 'test-super-admin',
  admin: 'test-admin',
  user: 'test-user',
  org: 'test-org-root',
  classGen: 'test-class-gen',
  folderRoot: 'test-folder-root',
} as const;

let prismaSingleton: PrismaClient | null = null;
let migrated = false;

/**
 * Get a PrismaClient pointed at the test DB. Asserts the connection string
 * is a test URL on first call so we never accidentally truncate dev/prod.
 */
export function getTestPrisma(): PrismaClient {
  if (prismaSingleton) return prismaSingleton;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL not set — integration tests require a test database. ' +
        'Set DATABASE_URL=postgresql://drawing:drawing@localhost:5433/drawing_test',
    );
  }
  if (!TEST_DB_GUARD.test(url)) {
    throw new Error(
      'Refusing to run integration tests against a non-_test database: ' + url,
    );
  }

  prismaSingleton = new PrismaClient({
    log: ['error'],
    datasources: { db: { url } },
  });
  return prismaSingleton;
}

/**
 * Run `prisma migrate deploy` once per process. Idempotent: subsequent
 * calls are a no-op.
 */
export async function ensureSchema(): Promise<void> {
  if (migrated) return;
  const url = process.env.DATABASE_URL;
  if (!url || !TEST_DB_GUARD.test(url)) {
    throw new Error('ensureSchema: refusing to run against non-test DB');
  }
  // Resolve schema relative to apps/web so the test runner can be invoked
  // from any cwd.
  const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
  // `migrate deploy` is the canonical way to apply migrations in CI. It
  // skips already-applied migrations and never resets data.
  //
  // We swallow stdout to keep the test output readable; failures still
  // bubble up as a thrown error.
  execSync(
    `pnpm exec prisma migrate deploy --schema "${schemaPath}"`,
    {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, DATABASE_URL: url },
    },
  );
  // Apply manual SQL migrations too — `migrate deploy` only handles the
  // prisma-generated ones under `migrations/`, but our `migrations/manual/`
  // directory holds idempotent additive ALTERs that don't have a Prisma
  // counterpart yet (pgvector, virus scan columns, etc.).
  await applyManualMigrations(url);
  migrated = true;
}

/**
 * Apply every SQL file under `prisma/migrations/manual/` in lexical order.
 * Idempotent — the files use `CREATE ... IF NOT EXISTS` and `ADD COLUMN
 * IF NOT EXISTS` so re-running is safe.
 */
async function applyManualMigrations(url: string): Promise<void> {
  const fs = await import('node:fs/promises');
  const dir = path.resolve(__dirname, '../../prisma/migrations/manual');
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return; // no manual dir, nothing to do
  }
  const sqlFiles = entries.filter((f) => f.endsWith('.sql')).sort();
  if (sqlFiles.length === 0) return;
  const client = getTestPrisma();
  for (const file of sqlFiles) {
    const full = path.join(dir, file);
    const sql = await fs.readFile(full, 'utf8');
    // Each manual migration is wrapped in BEGIN/COMMIT itself; `$executeRawUnsafe`
    // can run a multi-statement string in a single round trip.
    try {
      await client.$executeRawUnsafe(sql);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[setup] manual migration ${file} failed:`, err);
    }
  }
}

/**
 * TRUNCATE every domain table in dependency-friendly order. Faster than
 * `migrate reset` and keeps the schema (sequences, constraints) intact.
 *
 * Add new tables here when models are introduced.
 */
export async function resetDb(): Promise<void> {
  const client = getTestPrisma();
  // RESTART IDENTITY resets sequences. CASCADE ensures FK chains drop in
  // one statement so we don't have to enumerate the dependency graph.
  await client.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Notification",
      "ActivityLog",
      "ApiKey",
      "Backup",
      "Upload",
      "ChatMessage",
      "ChatSession",
      "ManualChunk",
      "Notice",
      "SystemLog",
      "ConversionJob",
      "LobbyReply",
      "LobbyTargetCompany",
      "LobbyAttachment",
      "Lobby",
      "ApprovalStep",
      "Approval",
      "Attachment",
      "Version",
      "Revision",
      "ObjectAttributeValue",
      "LinkedObject",
      "UserObjectPin",
      "UserFolderPin",
      "ObjectEntity",
      "FolderPermission",
      "Folder",
      "ObjectAttribute",
      "ObjectClass",
      "NumberRulePart",
      "NumberRule",
      "UserGroup",
      "Group",
      "User",
      "Organization"
    RESTART IDENTITY CASCADE;
  `);
}

/**
 * Insert a minimal seed: 3 users (super-admin, admin, plain user), 1 org,
 * 1 class, 1 root folder. Tests that need richer data layer their own rows
 * on top.
 */
export async function seedBasics(): Promise<void> {
  const client = getTestPrisma();
  // Hash once and reuse — bcrypt is the slow part of the setup.
  const password = await bcrypt.hash('test-password-1234', 4);
  await client.organization.create({
    data: { id: TEST_IDS.org, name: '테스트 본사', sortOrder: 0 },
  });
  await client.user.createMany({
    data: [
      {
        id: TEST_IDS.superAdmin,
        username: 'supertest',
        passwordHash: password,
        fullName: '슈퍼 테스트',
        role: 'SUPER_ADMIN',
        securityLevel: 1,
        organizationId: TEST_IDS.org,
        email: 'super@test.local',
      },
      {
        id: TEST_IDS.admin,
        username: 'admintest',
        passwordHash: password,
        fullName: '관리자 테스트',
        role: 'ADMIN',
        securityLevel: 2,
        organizationId: TEST_IDS.org,
        email: 'admin@test.local',
      },
      {
        id: TEST_IDS.user,
        username: 'usertest',
        passwordHash: password,
        fullName: '사용자 테스트',
        role: 'USER',
        securityLevel: 5,
        organizationId: TEST_IDS.org,
        email: 'user@test.local',
      },
    ],
  });
  await client.objectClass.create({
    data: { id: TEST_IDS.classGen, code: 'GEN', name: '일반' },
  });
  await client.folder.create({
    data: {
      id: TEST_IDS.folderRoot,
      name: '루트',
      folderCode: 'TEST-ROOT',
      defaultClassId: TEST_IDS.classGen,
    },
  });
  // Grant the plain user view+edit on the root folder so EDIT routes work.
  await client.folderPermission.create({
    data: {
      folderId: TEST_IDS.folderRoot,
      principalType: 'USER',
      principalId: TEST_IDS.user,
      viewFolder: true,
      editFolder: true,
      viewObject: true,
      editObject: true,
      deleteObject: false,
      approveObject: false,
      download: true,
      print: true,
    },
  });
}

/**
 * Convenience: ensure schema + reset + seed. Call from beforeEach in tests
 * that want a fresh world per case.
 */
export async function freshWorld(): Promise<void> {
  await ensureSchema();
  await resetDb();
  await seedBasics();
}

/**
 * Tear down the prisma client. Call from afterAll to release the
 * connection pool; otherwise vitest hangs after the suite finishes.
 */
export async function disposeTestPrisma(): Promise<void> {
  if (prismaSingleton) {
    await prismaSingleton.$disconnect();
    prismaSingleton = null;
  }
}
