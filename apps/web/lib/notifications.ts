// Notification enqueue helper — R29 / N-1, extended in R35 with the mail
// channel side-channel.
//
// Wraps a single `prisma.notification.create()` call so every hotspot uses
// the same shape. Designed to run inside the Prisma transaction that
// originated the event so a successful mutation always produces a
// notification and a failed one produces none.
//
// R35 extension: after creating the in-app row, this helper now also pushes
// a job onto the BullMQ `mail` queue when:
//   (a) `MAIL_ENABLED=1` is set in the environment (lib/mail.ts gate), AND
//   (b) the recipient's `User.notifyByEmail` is true, AND
//   (c) the recipient has an `email` populated.
//
// The mail enqueue is best-effort and runs as a deferred side-effect after
// the in-app row creation. It does NOT block transaction commit and does
// NOT propagate failures up to the caller — a transient Redis or BullMQ
// glitch must not abort the originating mutation. The Notification row is
// the long-term source of truth; the email is a courtesy channel.
//
// Function signature is unchanged from R29 so existing call sites at
// `objects/[id]/{checkin,release}`, `approvals/[id]/{approve,reject}`,
// `lobbies/[id]/replies`, and `admin/users/[id]/{unlock,reset-password}`
// keep working untouched.
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

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isMailEnabled } from '@/lib/mail';
import { enqueueMail } from '@/lib/mail-queue';

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
 * After the row is created, fan out to the mail queue when the recipient
 * has opted in and the global mail gate is enabled. The fanout is
 * fire-and-forget: failures inside `enqueueMail` are logged but do not
 * propagate (an SMTP outage must not roll back the user's mutation).
 *
 * Returns the created row so callers can include it in the response if they
 * want to (most callers ignore the return value).
 */
export async function enqueueNotification(
  client: PrismaTxClient,
  input: NotificationInput,
) {
  const row = await client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      objectId: input.objectId ?? null,
      metadata: input.metadata ?? Prisma.JsonNull,
    },
  });

  // ─── R35 — mail channel fanout (best-effort) ──────────────────────────
  // Skip cheap when the global gate is off; avoids a useless DB lookup on
  // every notification in dev/CI.
  if (isMailEnabled()) {
    // Look up via the same tx client so we see the consistent state of the
    // user (e.g. the row was just created in the same transaction). The
    // lookup is intentionally narrow — only the channel preference and the
    // recipient address.
    try {
      const recipient = await client.user.findUnique({
        where: { id: input.userId },
        select: { email: true, notifyByEmail: true, fullName: true },
      });
      if (recipient?.notifyByEmail && recipient.email) {
        const { subject, text } = buildMailContent(input, recipient.fullName);
        // Fire-and-forget. We deliberately don't await: BullMQ push must not
        // hold the originating transaction open, and a Redis hiccup must
        // not abort the mutation.
        void enqueueMail({
          notificationId: row.id,
          to: recipient.email,
          subject,
          text,
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[notifications] mail enqueue failed', err);
        });
      }
    } catch (err) {
      // Recipient lookup failed — log and move on. The in-app row was
      // already created so the user will still see the notification.
      // eslint-disable-next-line no-console
      console.error('[notifications] mail fanout lookup failed', err);
    }
  }

  return row;
}

/**
 * Compose the mail subject + plaintext body from a notification input.
 *
 * Subject = title (kept short for inbox display).
 * Body    = `[name] 안녕하세요` greeting + title + body + (optional link to
 *           the related object).
 *
 * `NEXT_PUBLIC_BASE_URL` (set in csrf.ts and elsewhere) drives the link
 * origin; falls back to a relative path so dev mail is still readable.
 */
function buildMailContent(
  input: NotificationInput,
  fullName: string,
): { subject: string; text: string } {
  const lines: string[] = [];
  lines.push(`${fullName}님,`);
  lines.push('');
  lines.push(input.title);
  if (input.body) {
    lines.push('');
    lines.push(input.body);
  }
  if (input.objectId) {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? '';
    const link = `${base}/objects/${input.objectId}`;
    lines.push('');
    lines.push(`바로가기: ${link}`);
  }
  lines.push('');
  lines.push('— drawing-mgmt');
  lines.push(
    '이 메일은 알림 환경설정에 따라 자동 발송되었습니다. 설정 변경은 /settings 페이지에서 가능합니다.',
  );
  return {
    subject: input.title,
    text: lines.join('\n'),
  };
}
