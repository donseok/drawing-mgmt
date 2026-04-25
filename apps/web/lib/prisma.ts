/**
 * PrismaClient singleton.
 *
 * Next.js dev server hot-reloads modules on every change which would otherwise
 * spawn a new PrismaClient (and a new connection pool) per reload, exhausting
 * Postgres `max_connections` quickly. We cache the instance on `globalThis`
 * so HMR reuses the same client.
 *
 * In production we still create a single client per process.
 *
 * Reference: TRD §3 / Prisma official Next.js best-practice.
 */
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const logLevels: Array<'query' | 'error' | 'warn'> =
  process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'];

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: logLevels,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

export default prisma;
