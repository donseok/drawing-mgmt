// Notification enqueue helper — R29 / N-1.
//
// Wraps a single `prisma.notification.create()` call so every hotspot uses
// the same shape. Designed to run inside the Prisma transaction that
// originated the event so a successful mutation always produces a
// notification and a failed one produces none.
//
// Usage:
//   await prisma.$transaction(async (tx) => {
//     // ...mutation...
//     await enqueueNotification(tx, {
//       userId: ownerId,
//       type: 'OBJECT_CHECKIN',
//       title: '체크인되었습니다',
//       body: obj.number,
//       objectId: obj.id,
//     });
//   });
//
// The helper intentionally swallows nothing — if the insert fails the caller
// should let the transaction roll back. Audit-side fire-and-forget logging
// stays in `lib/audit.ts`.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Subset of Prisma client surface we use. Accepts both the top-level
 * `prisma` and a `tx` from `prisma.$transaction(async (tx) => ...)`.
 */
type PrismaTxClient = Prisma.TransactionClient | typeof prisma;

export interface NotificationInput {
  /** Recipient. Skip the call when this equals the actor (handled by callers). */
  userId: string;
  /**
   * Stable English code. Reuses ActivityLog action vocabulary
   * (OBJECT_CHECKIN, APPROVE, LOBBY_REPLY, ...) plus dedicated USER_*
   * codes for events without a 1:1 ActivityLog row.
   */
  type: string;
  title: string;
  body?: string | null;
  objectId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

/**
 * Insert a single notification row. Pass either the global `prisma` client
 * or a transaction client (`tx`) from `prisma.$transaction`.
 *
 * Returns the created row so callers can include it in the response if they
 * want to (most callers ignore the return value).
 */
export async function enqueueNotification(
  client: PrismaTxClient,
  input: NotificationInput,
) {
  return client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      objectId: input.objectId ?? null,
      metadata: input.metadata ?? Prisma.JsonNull,
    },
  });
}
