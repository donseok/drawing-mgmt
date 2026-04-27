// R35 / N-1 — SMTP transport wrapper.
//
// The web app rarely sends mail directly; instead it pushes a payload onto
// the BullMQ `mail` queue (see `lib/mail-queue.ts`) and the worker consumes
// it. We still expose `sendMail()` here because:
//   - the worker imports the same module to keep transport config in one
//     place (apps/worker re-exports a sibling copy or imports this lazily),
//   - admin-side smoke tests can call the function directly to verify SMTP
//     credentials without going through Redis,
//   - the dev / CI no-op path stays in a single file.
//
// Two gates:
//   1. `MAIL_ENABLED !== '1'` — log the would-be send and return immediately.
//      This is the dev/CI default; SMTP_* may be empty.
//   2. The transporter itself — only constructed when `MAIL_ENABLED=1`,
//      lazy-initialized so `import './mail'` in a route doesn't open a TCP
//      connection during build.
//
// nodemailer is MIT — no GPL exposure.

import nodemailer, { type Transporter, type SendMailOptions } from 'nodemailer';

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML alternative. When omitted, nodemailer sends text-only. */
  html?: string;
}

export interface SendMailResult {
  /** True if a send attempt was made (even if SMTP rejected). False = no-op. */
  attempted: boolean;
  /** nodemailer message id when the send succeeded. */
  messageId?: string;
  /** Recipients reported by the SMTP server as accepted. */
  accepted?: string[];
  /** Recipients rejected. */
  rejected?: string[];
}

/**
 * Returns true when the mail subsystem should attempt a send. We check both
 * the env flag and that we have a host configured — sending without a host
 * will hang the worker for the connection timeout.
 */
export function isMailEnabled(): boolean {
  if (process.env.MAIL_ENABLED !== '1') return false;
  if (!process.env.SMTP_HOST) return false;
  return true;
}

let transporterSingleton: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporterSingleton) return transporterSingleton;
  const port = Number(process.env.SMTP_PORT ?? '587');
  // SMTP_SECURE=1 forces TLS-on-connect (port 465). Default to STARTTLS on 587.
  const secure = process.env.SMTP_SECURE === '1';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  transporterSingleton = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    // Auth is optional — internal relays sometimes accept without credentials.
    auth: user && pass ? { user, pass } : undefined,
  });
  return transporterSingleton;
}

/**
 * Send a single email. When `MAIL_ENABLED !== '1'` (or SMTP_HOST is missing)
 * this is a no-op: it logs the would-be recipient/subject and returns without
 * opening a connection. Callers do not need to special-case dev/CI.
 *
 * On real failures the underlying nodemailer error is propagated so the
 * caller (typically the BullMQ worker) can flag the job as failed and let
 * the retry policy take over.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  if (!isMailEnabled()) {
    // eslint-disable-next-line no-console
    console.info(
      `[mail] disabled (MAIL_ENABLED!=1) — would send to=${input.to} subject=${JSON.stringify(input.subject)}`,
    );
    return { attempted: false };
  }

  const from =
    process.env.SMTP_FROM ?? 'drawing-mgmt <noreply@drawing-mgmt.local>';
  const opts: SendMailOptions = {
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
  };
  if (input.html) opts.html = input.html;

  const info = await getTransporter().sendMail(opts);
  return {
    attempted: true,
    messageId: info.messageId,
    accepted: (info.accepted ?? []).map(addrToString),
    rejected: (info.rejected ?? []).map(addrToString),
  };
}

/**
 * nodemailer reports `accepted` / `rejected` as `(string | Address)[]`.
 * Normalize to plain string for the SendMailResult contract so callers
 * don't have to branch.
 */
function addrToString(a: string | { address: string }): string {
  return typeof a === 'string' ? a : a.address;
}

// Test seam — let unit tests inject a fake transporter instead of opening a
// real socket. Production code never calls this.
export function __setTransporterForTesting(
  next: Transporter | null,
): void {
  transporterSingleton = next;
}
