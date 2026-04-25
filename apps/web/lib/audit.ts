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
