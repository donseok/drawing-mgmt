/**
 * R35 N-1 — Worker-side SMTP sender (nodemailer, MIT).
 *
 * This is the worker's own copy of the SMTP transport. The web layer has a
 * sibling implementation at `apps/web/lib/mail.ts` for any synchronous /
 * inline emails (e.g. password-reset confirmations); the worker module is
 * what consumes the BullMQ `mail` queue.
 *
 * Why duplicate instead of sharing through `packages/shared`:
 *   - `nodemailer` is a server-only Node API. Putting it in the shared
 *     package would make it tempting to import from FE bundles.
 *   - Shared package is pure schemas/types (zod, no runtime deps beyond
 *     zod). Adding nodemailer would inflate every consumer's dep graph.
 *   - The two copies stay deliberately small (~50 lines each) and the
 *     queue payload schema in `@drawing-mgmt/shared/conversion` is the
 *     contract that keeps them in sync.
 *
 * Env contract (read lazily at first send so tests can stub via env):
 *   MAIL_ENABLED   — '1' to actually send, anything else = no-op + log.
 *   SMTP_HOST      — required when enabled.
 *   SMTP_PORT      — defaults to 587 (STARTTLS) or 465 when SECURE=1.
 *   SMTP_USER/PASS — auth pair. Both empty → no auth (open relay).
 *   SMTP_SECURE    — '1' for implicit TLS (port 465).
 *   SMTP_FROM      — From: header. Falls back to SMTP_USER when unset.
 */

import nodemailer, { type Transporter } from 'nodemailer';

export interface SendMailParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendMailResult {
  /**
   * 'sent'    — accepted by SMTP server (messageId populated).
   * 'skipped' — MAIL_ENABLED!=='1', body logged but no send attempted.
   */
  status: 'sent' | 'skipped';
  messageId?: string;
}

let cachedTransport: Transporter | null = null;

function isMailEnabled(): boolean {
  return process.env.MAIL_ENABLED === '1';
}

/**
 * Lazy singleton — built on first send. Re-reads env each call, but the
 * Transporter itself is cached because nodemailer pools connections per
 * Transporter instance. Tests that mutate env between cases should call
 * `__resetMailTransportForTests` (see bottom).
 */
function getTransport(): Transporter {
  if (cachedTransport) return cachedTransport;
  const host = process.env.SMTP_HOST;
  if (!host) {
    throw new Error(
      'SMTP_HOST is not set; refusing to construct mail transport with MAIL_ENABLED=1',
    );
  }
  const secure = process.env.SMTP_SECURE === '1';
  const port = Number(process.env.SMTP_PORT ?? (secure ? 465 : 587));
  const user = process.env.SMTP_USER ?? '';
  const pass = process.env.SMTP_PASS ?? '';
  const auth = user || pass ? { user, pass } : undefined;
  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
  });
  return cachedTransport;
}

/**
 * Send a single email. When `MAIL_ENABLED!=='1'` returns `{ status: 'skipped' }`
 * after logging the would-be payload — useful in dev/CI so the rest of the
 * notification pipeline can run without an actual SMTP server.
 *
 * Throws on transport / auth / 5xx delivery failures so the BullMQ worker
 * can let its retry policy do its job.
 */
export async function sendMail(params: SendMailParams): Promise<SendMailResult> {
  if (!isMailEnabled()) {
    // Mirror the format the worker's pino logger uses so dev tail still
    // shows the recipient when a job goes through.
    console.log(
      `[mail] skipped (MAIL_ENABLED!=1) to=${params.to} subject=${JSON.stringify(params.subject)}`,
    );
    return { status: 'skipped' };
  }

  const transport = getTransport();
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;
  if (!from) {
    throw new Error('SMTP_FROM (or SMTP_USER as fallback) is required when MAIL_ENABLED=1');
  }
  const info = await transport.sendMail({
    from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
  return { status: 'sent', messageId: info.messageId };
}

/** Test helper — clears the cached Transporter so env changes take effect. */
export function __resetMailTransportForTests(): void {
  cachedTransport = null;
}
