// R38 / N-2 — KakaoTalk 알림톡 (BizMessage) transport wrapper.
//
// Mirrors lib/sms.ts shape but the protocol is template-driven: Kakao only
// allows pre-approved `templateCode` values, and free-form `text` is rejected
// at the gateway. Variables are interpolated server-side (NCP SENS / vendor-
// specific) so we ship `{ to, templateCode, variables }` instead of a body.
//
// Driver dispatch (env `KAKAO_DRIVER`):
//   - `ncp`  — Naver Cloud Platform SENS Kakao Alimtalk REST API. Generic
//              HTTP POST signed with the provider API key. Stub-friendly:
//              the request shape matches what's documented but minimal —
//              real-world integrations may need to add iv11n on top.
//   - unset / `disabled` / `''`  — returns SKIPPED + logs.
//
// `KAKAO_ENABLED=0` (or unset) short-circuits to SKIPPED before any driver
// dispatch — same shape as `MAIL_ENABLED=0` in lib/mail.ts.
//
// License posture: native `fetch` only, zero npm deps. Future SDK integration
// (Kakao Channels biz API, Kakao official Node SDK if it appears) MUST be
// gated through this same `sendKakao()` interface and have its license
// reviewed first — no GPL/AGPL deps.

export type KakaoStatus = 'SENT' | 'SKIPPED' | 'FAILED';

export interface SendKakaoInput {
  /** Destination phone number (E.164-ish; normalized before dispatch). */
  to: string;
  /**
   * Pre-approved BizMessage template code. Required — Kakao rejects free-form
   * text. Empty string causes a FAILED result with a descriptive error.
   */
  templateCode: string;
  /**
   * Template variable map (`{name}` placeholders inside the template body
   * that the provider substitutes). Order does not matter; all keys are
   * stringified at the edge.
   */
  variables: Record<string, string>;
}

export interface SendKakaoResult {
  status: KakaoStatus;
  /** Provider-side message id when SENT. */
  providerId?: string;
  /** Error message when FAILED. */
  errorMessage?: string;
}

export type KakaoDriver = 'ncp' | 'disabled';

export function isKakaoEnabled(): boolean {
  if (process.env.KAKAO_ENABLED !== '1') return false;
  const driver = resolveDriver();
  return driver !== 'disabled';
}

export function resolveDriver(): KakaoDriver {
  const raw = (process.env.KAKAO_DRIVER ?? '').trim().toLowerCase();
  if (raw === 'ncp') return 'ncp';
  return 'disabled';
}

/**
 * Send a single KakaoTalk 알림톡. When `KAKAO_ENABLED !== '1'` (or driver
 * unset) this is a no-op: it logs the would-be payload and returns SKIPPED.
 *
 * On real failures (provider rejects, network) returns
 * `{ status: 'FAILED', errorMessage }` rather than throwing — the BullMQ
 * worker decides on retry.
 */
export async function sendKakao(input: SendKakaoInput): Promise<SendKakaoResult> {
  if (!isKakaoEnabled()) {
    // eslint-disable-next-line no-console
    console.info(
      `[kakao] disabled (KAKAO_ENABLED!=1 or driver unset) — would send to=${input.to} templateCode=${input.templateCode}`,
    );
    return { status: 'SKIPPED' };
  }
  if (!input.templateCode) {
    return {
      status: 'FAILED',
      errorMessage: 'templateCode is required (KakaoTalk rejects free-form text)',
    };
  }

  const driver = resolveDriver();
  try {
    if (driver === 'ncp') return await sendViaNcp(input);
    return { status: 'SKIPPED' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[kakao] send failed', err);
    return { status: 'FAILED', errorMessage: message };
  }
}

// ─── NCP SENS (Naver Cloud Platform) driver ────────────────────────────────
//
// Uses NCP SENS Alimtalk REST API. Endpoint format:
//   POST {KAKAO_API_ENDPOINT}
// where the endpoint typically looks like
//   https://sens.apigw.ntruss.com/alimtalk/v2/services/{serviceId}/messages
//
// Authentication: NCP SENS expects HMAC-SHA256 signing with `x-ncp-apigw-*`
// headers. Many internal NCP wrappers strip this down to a simple bearer
// scheme by fronting it with their own gateway. To keep the adapter
// dependency-free we ship the bearer-style call here; deployments that need
// raw NCP signing should fork this driver and add `crypto.createHmac`.
async function sendViaNcp(input: SendKakaoInput): Promise<SendKakaoResult> {
  const endpoint = process.env.KAKAO_API_ENDPOINT;
  const apiKey = process.env.KAKAO_API_KEY;
  const senderKey = process.env.KAKAO_SENDER_KEY;
  if (!endpoint) {
    return { status: 'FAILED', errorMessage: 'KAKAO_API_ENDPOINT unset' };
  }
  if (!apiKey) {
    return { status: 'FAILED', errorMessage: 'KAKAO_API_KEY unset' };
  }
  if (!senderKey) {
    return { status: 'FAILED', errorMessage: 'KAKAO_SENDER_KEY unset' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    // Some gateways prefer a custom header; include both for compatibility.
    'x-ncp-api-key': apiKey,
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      plusFriendId: senderKey,
      templateCode: input.templateCode,
      messages: [
        {
          to: normalizePhone(input.to),
          // NCP expects the variables substituted into the rendered content;
          // we ship them as a structured block so the gateway can map them.
          variables: input.variables,
        },
      ],
    }),
  });

  if (!res.ok) {
    const bodyText = await safeReadText(res);
    return {
      status: 'FAILED',
      errorMessage: `provider HTTP ${res.status}: ${truncate(bodyText, 200)}`,
    };
  }

  let providerId: string | undefined;
  try {
    const json = (await res.json()) as
      | { requestId?: string; messageId?: string; id?: string }
      | undefined;
    providerId = json?.requestId ?? json?.messageId ?? json?.id;
  } catch {
    /* non-JSON OK */
  }
  return { status: 'SENT', providerId };
}

// ─── helpers ───────────────────────────────────────────────────────────────
export function normalizePhone(raw: string): string {
  if (!raw) return raw;
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
