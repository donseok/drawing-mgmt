// Notification enqueue helper — R29 / N-1, extended in R35 (mail) and R38
// (SMS + KakaoTalk) with side-channel fanouts.
//
// Wraps a single `prisma.notification.create()` call so every hotspot uses
// the same shape. Designed to run inside the Prisma transaction that
// originated the event so a successful mutation always produces a
// notification and a failed one produces none.
//
// R35 extension (N-1, mail): after creating the in-app row, push a job onto
// the BullMQ `mail` queue when:
//   (a) `MAIL_ENABLED=1` is set in the environment (lib/mail.ts gate), AND
//   (b) the recipient's `User.notifyByEmail` is true, AND
//   (c) the recipient has an `email` populated.
//
// R38 extension (N-2, SMS): push a job onto the BullMQ `sms` queue when:
//   (a) `SMS_ENABLED=1` (lib/sms.ts gate), AND
//   (b) the recipient's `User.notifyBySms` is true, AND
//   (c) the recipient has a populated `phoneNumber`.
//
// R38 extension (N-2, Kakao 알림톡): push onto the BullMQ `kakao` queue
// when:
//   (a) `KAKAO_ENABLED=1` (lib/kakao.ts gate), AND
//   (b) the recipient's `User.notifyByKakao` is true, AND
//   (c) the recipient has a populated `phoneNumber`, AND
//   (d) `KAKAO_DEFAULT_TEMPLATE_CODE` is configured (Kakao rejects free-form).
//
// All three side-channels are best-effort and run as deferred side-effects
// after the in-app row creation. They do NOT block transaction commit and
// do NOT propagate failures up to the caller — a transient Redis / SMTP /
// SMS-provider glitch must not abort the originating mutation. The
// Notification row is the long-term source of truth; the email/SMS/Kakao
// sends are courtesy channels.
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
import { isSmsEnabled } from '@/lib/sms';
import { enqueueSms } from '@/lib/sms-queue';
import { isKakaoEnabled } from '@/lib/kakao';
import { enqueueKakao } from '@/lib/kakao-queue';

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
 * After the row is created, fan out to the mail / sms / kakao queues when
 * the recipient has opted in and the matching global gate is enabled. The
 * fanouts are fire-and-forget: failures inside the enqueue helpers are
 * logged but do not propagate (an SMTP / SMS-provider outage must not roll
 * back the user's mutation).
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

  // ─── R35 / R38 — channel fanout (best-effort) ─────────────────────────
  //
  // Each channel (mail, sms, kakao) gates on its env-level enable flag
  // first, so dev/CI with everything off does ZERO recipient lookups. When
  // any one is on we do a single combined `findUnique` and pick which
  // queues to push onto from the result — keeps us at one DB roundtrip
  // regardless of how many channels are active.
  const mailOn = isMailEnabled();
  const smsOn = isSmsEnabled();
  const kakaoOn = isKakaoEnabled();
  if (mailOn || smsOn || kakaoOn) {
    try {
      const recipient = await client.user.findUnique({
        where: { id: input.userId },
        select: {
          email: true,
          notifyByEmail: true,
          fullName: true,
          // R38 — SMS + Kakao toggles + phoneNumber.
          phoneNumber: true,
          notifyBySms: true,
          notifyByKakao: true,
        },
      });

      if (recipient) {
        // ── Mail ──
        if (mailOn && recipient.notifyByEmail && recipient.email) {
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

        // ── SMS ──
        // Skip when the user hasn't filled in `phoneNumber` even if they
        // toggled the channel on; better to silently drop than to send a
        // partially-validated number to the provider.
        if (
          smsOn &&
          recipient.notifyBySms &&
          recipient.phoneNumber &&
          recipient.phoneNumber.trim()
        ) {
          const text = buildSmsBody(input, recipient.fullName);
          void enqueueSms({
            notificationId: row.id,
            to: recipient.phoneNumber,
            text,
          }).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[notifications] sms enqueue failed', err);
          });
        }

        // ── Kakao 알림톡 ──
        // Requires a pre-approved templateCode (Kakao rejects free-form).
        // We read `KAKAO_DEFAULT_TEMPLATE_CODE` here so deployments that
        // haven't approved a template yet stay fully gated — even if a user
        // toggled `notifyByKakao` on. This is intentionally permissive:
        // future call-site overrides can pass a per-event code through a
        // metadata field without breaking the existing call sites.
        const kakaoTemplate = process.env.KAKAO_DEFAULT_TEMPLATE_CODE;
        if (
          kakaoOn &&
          kakaoTemplate &&
          recipient.notifyByKakao &&
          recipient.phoneNumber &&
          recipient.phoneNumber.trim()
        ) {
          const variables = buildKakaoVariables(input, recipient.fullName);
          void enqueueKakao({
            notificationId: row.id,
            to: recipient.phoneNumber,
            templateCode: kakaoTemplate,
            variables,
          }).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[notifications] kakao enqueue failed', err);
          });
        }
      }
    } catch (err) {
      // Recipient lookup failed — log and move on. The in-app row was
      // already created so the user will still see the notification.
      // eslint-disable-next-line no-console
      console.error('[notifications] channel fanout lookup failed', err);
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

/**
 * Compose the SMS body. Korean SMS short-format caps at ~90 bytes (≈ 45 KR
 * chars), so we keep the body terse: title + (truncated) body. The title
 * alone is usually enough — `body` is appended only when it fits cleanly.
 */
function buildSmsBody(input: NotificationInput, fullName: string): string {
  const head = `[drawing-mgmt] ${input.title}`;
  if (!input.body) return head;
  // Approximate SMS short-format budget for Korean text. We don't try to be
  // pixel-perfect — over-budget messages just become MMS at the gateway.
  const budget = 80;
  const remaining = budget - head.length - 1;
  if (remaining <= 8) return head;
  const body =
    input.body.length > remaining
      ? `${input.body.slice(0, remaining - 1)}…`
      : input.body;
  // `fullName` intentionally unused in the SMS body — short-format budget is
  // tight and the recipient already knows who they are. Kept as parameter
  // for symmetry with `buildMailContent` / `buildKakaoVariables`.
  void fullName;
  return `${head}\n${body}`;
}

/**
 * Compose the variable map sent to KakaoTalk Alimtalk. The variable names
 * mirror what an approved BizMessage template would declare; deployments
 * customize the template body but the variable contract stays:
 *
 *   {name}    — recipient name
 *   {title}   — notification title (same as in-app)
 *   {body}    — notification body (may be empty)
 *   {link}    — deep link to the related object (may be empty)
 */
function buildKakaoVariables(
  input: NotificationInput,
  fullName: string,
): Record<string, string> {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const link = input.objectId ? `${base}/objects/${input.objectId}` : '';
  return {
    name: fullName,
    title: input.title,
    body: input.body ?? '',
    link,
  };
}
