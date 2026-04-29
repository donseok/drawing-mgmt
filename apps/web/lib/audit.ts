// Activity log helper — wraps Prisma ActivityLog writes.
// Errors are swallowed (logged) so audit failures never block user actions.
// See TRD §8.1, §10.2.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface ActivityInput {
  userId: string;
  /**
   * Stable English action code, e.g. 'LOGIN', 'LOGIN_FAIL', 'OBJECT_CHECKOUT',
   * 'OBJECT_CHECKIN', 'OBJECT_RELEASE', 'OBJECT_DELETE', 'APPROVE', 'REJECT'.
   */
  action: string;
  objectId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        objectId: input.objectId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  } catch (err) {
    // Don't throw from audit — log to stderr and move on.
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write activity log', err);
  }
}

/**
 * Bulk variant — single `createMany` for N audit rows. Use in bulk endpoints
 * where the per-row ordering doesn't matter (the createdAt timestamp orders
 * them deterministically) but the wall time of N sequential round-trips
 * does. Errors are swallowed identically to `logActivity`.
 */
export async function logActivityBatch(rows: readonly ActivityInput[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await prisma.activityLog.createMany({
      data: rows.map((r) => ({
        userId: r.userId,
        action: r.action,
        objectId: r.objectId ?? null,
        ipAddress: r.ipAddress ?? null,
        userAgent: r.userAgent ?? null,
        metadata: r.metadata ?? Prisma.JsonNull,
      })),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write activity log batch', err);
  }
}

/**
 * Pull request metadata (IP + UA) from a Headers/Request-like object.
 * Centralized so all routes log consistently.
 */
export function extractRequestMeta(req: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const h = req.headers;
  // Behind Nginx / Vercel: trust x-forwarded-for first.
  const xff = h.get('x-forwarded-for');
  const ip = xff ? xff.split(',')[0]?.trim() ?? null : h.get('x-real-ip');
  return {
    ipAddress: ip ?? null,
    userAgent: h.get('user-agent'),
  };
}
