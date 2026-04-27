// R38 / N-2 — SMS transport wrapper.
//
// Mirrors lib/mail.ts. The web app rarely sends SMS directly; instead it
// pushes a payload onto the BullMQ `sms` queue (see `lib/sms-queue.ts`) and
// the worker (apps/worker/src/sms-worker.ts) consumes. We still expose
// `sendSms()` here because:
//   - the worker imports the same module to keep transport/driver config in
//     one place,
//   - admin-side smoke tests can call this directly to verify provider
//     credentials without going through Redis,
//   - the dev / CI no-op path stays in a single file.
//
// Driver dispatch (env `SMS_DRIVER`):
//   - `twilio`  — uses the official `twilio` npm SDK (Apache 2.0).
//   - `generic` — POSTs JSON to `SMS_GENERIC_ENDPOINT` (Korean providers
//                 generally accept this shape; tweak per-provider if needed).
//   - unset / `disabled` / `''`  — returns SKIPPED + logs (the dev/CI default).
//
// `SMS_ENABLED=0` (or unset) short-circuits to SKIPPED before any driver
// dispatch — same shape as `MAIL_ENABLED=0` in lib/mail.ts.
//
// License posture: twilio (Apache 2.0) + native fetch only. No GPL in the
// transitive npm tree. The `twilio` SDK is `import()`'d lazily so the dep is
// only resolved when actually configured (lets the build run without
// installing it for non-twilio deployments).

export type SmsStatus = 'SENT' | 'SKIPPED' | 'FAILED';

export interface SendSmsInput {
  /**
   * Destination phone number. Accepts hyphenated KR-style (`+82-10-...`) or
   * raw E.164 — drivers normalize to E.164 (digits + optional leading `+`)
   * before dispatch.
   */
  to: string;
  /** Plain-text body. Korean SMS bodies stay under 90 bytes for short-format. */
  text: string;
}

export interface SendSmsResult {
  status: SmsStatus;
  /** Provider-side message id when SENT (Twilio sid, NCP requestId, ...). */
  providerId?: string;
  /** Error message when FAILED. */
  errorMessage?: string;
}

export type SmsDriver = 'twilio' | 'generic' | 'disabled';

/**
 * Returns true when the SMS subsystem should attempt a send. Mirrors
 * `isMailEnabled()` in lib/mail.ts — gates on the master env flag and on a
 * driver being configured.
 */
export function isSmsEnabled(): boolean {
  if (process.env.SMS_ENABLED !== '1') return false;
  const driver = resolveDriver();
  return driver !== 'disabled';
}

export function resolveDriver(): SmsDriver {
  const raw = (process.env.SMS_DRIVER ?? '').trim().toLowerCase();
  if (raw === 'twilio') return 'twilio';
  if (raw === 'generic') return 'generic';
  return 'disabled';
}

/**
 * Send a single SMS. When `SMS_ENABLED !== '1'` (or no driver is configured)
 * this is a no-op: it logs the would-be recipient/text and returns SKIPPED
 * without opening a connection. Callers do not need to special-case dev/CI.
 *
 * On real failures (provider rejects, network) we catch and return
 * `{ status: 'FAILED', errorMessage }` rather than throwing — the BullMQ
 * worker decides whether to retry. The notification row is the long-term
 * source of truth, the SMS is a courtesy channel.
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  if (!isSmsEnabled()) {
    // eslint-disable-next-line no-console
    console.info(
      `[sms] disabled (SMS_ENABLED!=1 or driver unset) — would send to=${input.to} text=${truncate(input.text, 60)}`,
    );
    return { status: 'SKIPPED' };
  }

  const driver = resolveDriver();
  try {
    if (driver === 'twilio') return await sendViaTwilio(input);
    if (driver === 'generic') return await sendViaGeneric(input);
    return { status: 'SKIPPED' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[sms] send failed', err);
    return { status: 'FAILED', errorMessage: message };
  }
}

// ─── Twilio driver ─────────────────────────────────────────────────────────
async function sendViaTwilio(input: SendSmsInput): Promise<SendSmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    return {
      status: 'FAILED',
      errorMessage: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM unset',
    };
  }

  // Lazy import so deployments without the twilio dep don't fail to start.
  // The dynamic specifier is intentionally a string variable to discourage
  // bundlers from pulling the dep into the build graph when SMS is disabled.
  const moduleName = 'twilio';
  let twilio: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    twilio = await (Function('m', 'return import(m)') as any)(moduleName);
  } catch (err) {
    return {
      status: 'FAILED',
      errorMessage: `twilio module unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // The twilio SDK exports a `default` factory: `twilio(sid, token)`.
  type TwilioFactory = (sid: string, token: string) => {
    messages: {
      create: (opts: {
        body: string;
        from: string;
        to: string;
      }) => Promise<{ sid: string }>;
    };
  };
  // Cast to `unknown` first then probe for either CJS-style (callable
  // module) or ESM-style (`.default` factory). The intermediate `unknown`
  // step keeps TS from over-narrowing across the typeof discriminant.
  const mod = twilio as unknown;
  let factory: TwilioFactory | null = null;
  if (typeof mod === 'function') {
    factory = mod as TwilioFactory;
  } else if (mod && typeof (mod as { default?: unknown }).default === 'function') {
    factory = (mod as { default: TwilioFactory }).default;
  }
  if (!factory) {
    return {
      status: 'FAILED',
      errorMessage: 'twilio module does not expose expected factory',
    };
  }

  const client = factory(sid, token);
  const msg = await client.messages.create({
    body: input.text,
    from,
    to: normalizePhone(input.to),
  });
  return { status: 'SENT', providerId: msg.sid };
}

// ─── Generic HTTP driver ───────────────────────────────────────────────────
//
// Posts a JSON body to `SMS_GENERIC_ENDPOINT`. The body shape is intentionally
// boring so it's compatible with most Korean transactional SMS gateways
// (NCP-style, Aligo, etc.). Adapt the response parsing below if your provider
// returns something exotic.
async function sendViaGeneric(input: SendSmsInput): Promise<SendSmsResult> {
  const endpoint = process.env.SMS_GENERIC_ENDPOINT;
  if (!endpoint) {
    return {
      status: 'FAILED',
      errorMessage: 'SMS_GENERIC_ENDPOINT unset',
    };
  }
  const apiKey = process.env.SMS_GENERIC_API_KEY ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      to: normalizePhone(input.to),
      text: input.text,
    }),
  });

  if (!res.ok) {
    const bodyText = await safeReadText(res);
    return {
      status: 'FAILED',
      errorMessage: `provider HTTP ${res.status}: ${truncate(bodyText, 200)}`,
    };
  }

  // Best-effort parse of the providerId. If the provider returns plain text
  // we still consider the send successful.
  let providerId: string | undefined;
  try {
    const json = (await res.json()) as
      | { id?: string; messageId?: string; requestId?: string }
      | undefined;
    providerId = json?.id ?? json?.messageId ?? json?.requestId;
  } catch {
    /* non-JSON response — that's OK */
  }
  return { status: 'SENT', providerId };
}

// ─── helpers ───────────────────────────────────────────────────────────────
/**
 * Turn `+82-10-1234-5678` style strings into bare E.164 (`+821012345678`).
 * Leaves already-clean inputs alone. Empty / falsy inputs return as-is so the
 * downstream API surface keeps the original validation error.
 */
export function normalizePhone(raw: string): string {
  if (!raw) return raw;
  // Strip everything except leading `+` and digits.
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');
  return hasPlus ? `+${digits}` : digits;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
