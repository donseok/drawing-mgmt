/**
 * R38 N-2 — Worker-side SMS sender.
 *
 * Sibling to `./mail.ts`. Two driver shapes are supported, picked at send
 * time from `SMS_DRIVER`:
 *
 *   - `twilio`  — `twilio` npm package (Apache 2.0). Requires
 *                 TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM.
 *   - `generic` — Plain HTTPS POST against SMS_GENERIC_ENDPOINT, JSON body
 *                 `{ to, text }` with optional `Authorization: Bearer …`
 *                 from SMS_GENERIC_API_KEY. Provided for Korean providers
 *                 that don't have an Apache-licensed SDK we'd want to
 *                 take on as a transitive dep.
 *
 * Env-gated identically to mail: `SMS_ENABLED!=='1'` short-circuits to
 * `{ status: 'skipped' }` after a console log so the rest of the
 * notification fan-out can still run in dev/CI without a real account.
 *
 * Why duplicate against `apps/web/lib/sms.ts` instead of a shared module:
 * same reasoning as mail (R35) — the web copy is for inline/synchronous
 * sends (rare for SMS, kept for symmetry), and Twilio's SDK is a
 * server-only Node import we don't want leaking into web bundles.
 */

import {
  SmsJobPayloadSchema,
  type SmsJobPayload,
} from '@drawing-mgmt/shared/conversion';

export interface SendSmsParams {
  to: string;
  text: string;
}

export interface SendSmsResult {
  /**
   * 'sent'    — accepted by the provider (providerId populated).
   * 'skipped' — SMS_ENABLED!=='1' or no driver configured. Body logged,
   *             no network call. Caller should treat as success.
   */
  status: 'sent' | 'skipped';
  providerId?: string;
}

type SmsDriver = 'twilio' | 'generic' | 'none';

function resolveDriver(): SmsDriver {
  if (process.env.SMS_ENABLED !== '1') return 'none';
  const raw = (process.env.SMS_DRIVER ?? '').toLowerCase().trim();
  if (raw === 'twilio') return 'twilio';
  if (raw === 'generic') return 'generic';
  // SMS_ENABLED=1 but no driver chosen ⇒ skip rather than crash. A
  // misconfig at boot shouldn't take down the whole notification path.
  return 'none';
}

// ── Twilio driver ────────────────────────────────────────────────────────
//
// Loaded lazily so dev/CI installs can leave SMS_ENABLED=0 + skip the
// twilio dep being touched at all. We import via `await import` inside
// the send function; the package is declared in apps/worker/package.json
// so production builds always resolve it.

let cachedTwilioClient: unknown | null = null;

async function getTwilioClient(): Promise<{
  // Subset we actually use. Avoids a hard type dep for the rest of the
  // file when twilio isn't installed yet on a freshly-cloned dev machine.
  messages: {
    create: (args: {
      to: string;
      from: string;
      body: string;
    }) => Promise<{ sid: string }>;
  };
}> {
  if (cachedTwilioClient) return cachedTwilioClient as never;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error(
      'TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN required when SMS_DRIVER=twilio',
    );
  }
  // dynamic import keeps twilio out of the require graph when the driver
  // is not selected at startup.
  const mod = (await import('twilio')) as unknown as {
    default: (sid: string, token: string) => never;
  };
  // twilio exports a default factory function.
  const client = mod.default(sid, token);
  cachedTwilioClient = client;
  return client as never;
}

async function sendViaTwilio(
  params: SendSmsParams,
): Promise<SendSmsResult> {
  const from = process.env.TWILIO_FROM;
  if (!from) {
    throw new Error('TWILIO_FROM is required when SMS_DRIVER=twilio');
  }
  const client = await getTwilioClient();
  const msg = await client.messages.create({
    to: params.to,
    from,
    body: params.text,
  });
  return { status: 'sent', providerId: msg.sid };
}

// ── Generic HTTP driver ─────────────────────────────────────────────────
//
// Single-endpoint POST. No retries here — BullMQ owns retry policy at
// the worker layer. Body shape is intentionally minimal so KR providers
// can sit behind a thin reverse proxy if their API differs.

async function sendViaGeneric(
  params: SendSmsParams,
): Promise<SendSmsResult> {
  const endpoint = process.env.SMS_GENERIC_ENDPOINT;
  if (!endpoint) {
    throw new Error('SMS_GENERIC_ENDPOINT is required when SMS_DRIVER=generic');
  }
  const apiKey = process.env.SMS_GENERIC_API_KEY;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ to: params.to, text: params.text }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `generic SMS POST ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`,
    );
  }
  // Try to read a provider id but don't depend on it — many KR providers
  // return non-JSON 200s. status: 'sent' means "the wire call succeeded".
  let providerId: string | undefined;
  try {
    const json = (await res.json()) as { id?: unknown; messageId?: unknown };
    const id = json?.id ?? json?.messageId;
    if (typeof id === 'string') providerId = id;
  } catch {
    /* response body not JSON; that's fine */
  }
  return { status: 'sent', providerId };
}

/**
 * Send a single SMS. Throws on transport / 5xx so the BullMQ worker can
 * let its retry policy do its job. Returns `{ status: 'skipped' }` when
 * SMS is disabled at the env layer.
 */
export async function sendSms(params: SendSmsParams): Promise<SendSmsResult> {
  const driver = resolveDriver();
  if (driver === 'none') {
    console.log(
      `[sms] skipped (SMS_ENABLED!=1 or SMS_DRIVER unset) to=${params.to} text=${JSON.stringify(params.text.slice(0, 80))}`,
    );
    return { status: 'skipped' };
  }
  if (driver === 'twilio') return sendViaTwilio(params);
  return sendViaGeneric(params);
}

/**
 * Validate a raw BullMQ job payload against the shared zod schema. Tiny
 * helper exported so the worker doesn't have to re-import the schema —
 * keeps the SMS surface area in one file. Throws on shape mismatch.
 */
export function parseSmsJobPayload(data: unknown): SmsJobPayload {
  return SmsJobPayloadSchema.parse(data);
}

/** Test helper — clears cached driver clients so env mutations stick. */
export function __resetSmsDriverForTests(): void {
  cachedTwilioClient = null;
}
