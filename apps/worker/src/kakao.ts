/**
 * R38 N-2 — Worker-side KakaoTalk Bizmessage (알림톡) sender.
 *
 * No SDK. The Korean "알림톡" providers (NCP SENS, Aligo, Bizppurio, …)
 * each ship their own — most under Apache 2.0 but with heavy transitive
 * deps. We deliberately keep this driver as a generic HTTPS POST against
 * `KAKAO_API_ENDPOINT` so the worker stays bundle-light and the GPL
 * posture stays clean (no JS bindings).
 *
 * Driver selection:
 *   - `KAKAO_DRIVER=ncp` — NAVER Cloud SENS-shaped POST (the most common
 *                          Korean integration today).
 *   - `KAKAO_DRIVER=`     — combined with `KAKAO_ENABLED!='1'` ⇒ skipped.
 *
 * Real-world note: alimtalk requires a pre-approved `templateCode` per
 * message. Local dev has no way to register one, so this round is
 * deliberately stub-friendly: when KAKAO_ENABLED=0 (default) every
 * `sendKakao` call resolves to `{ status: 'skipped' }`. The wire shape
 * still matches the contract so the production deploy only needs env to
 * flip the channel on.
 */

import {
  KakaoJobPayloadSchema,
  type KakaoJobPayload,
} from '@drawing-mgmt/shared/conversion';

export interface SendKakaoParams {
  to: string;
  templateCode: string;
  variables: Record<string, string>;
}

export interface SendKakaoResult {
  /**
   * 'sent'    — provider accepted the message (providerId populated when
   *             the response body included one).
   * 'skipped' — KAKAO_ENABLED!=='1' or no driver configured. Body logged,
   *             no network call made.
   */
  status: 'sent' | 'skipped';
  providerId?: string;
}

type KakaoDriver = 'ncp' | 'none';

function resolveDriver(): KakaoDriver {
  if (process.env.KAKAO_ENABLED !== '1') return 'none';
  const raw = (process.env.KAKAO_DRIVER ?? '').toLowerCase().trim();
  if (raw === 'ncp') return 'ncp';
  return 'none';
}

/**
 * NAVER Cloud SENS-shaped POST. Endpoint + key + sender are env-driven
 * because every account gets its own values; the request body shape is
 * stable across SENS versions for plain 알림톡 (templateCode + variables).
 *
 * The provider returns JSON like `{ requestId, statusCode, … }`. We pull
 * `requestId` as `providerId` when present but don't fail when it's not —
 * a 2xx response means accepted-for-delivery in SENS' model.
 */
async function sendViaNcp(params: SendKakaoParams): Promise<SendKakaoResult> {
  const endpoint = process.env.KAKAO_API_ENDPOINT;
  const apiKey = process.env.KAKAO_API_KEY;
  const senderKey = process.env.KAKAO_SENDER_KEY;
  if (!endpoint || !apiKey || !senderKey) {
    throw new Error(
      'KAKAO_API_ENDPOINT + KAKAO_API_KEY + KAKAO_SENDER_KEY required when KAKAO_DRIVER=ncp',
    );
  }

  // SENS-style body. The provider expects `messages[].to` + `content` per
  // message; for our single-recipient, single-template call this collapses
  // to a single-element array. `variables` is forwarded as-is — the
  // provider performs the substitution against the registered template.
  const body = {
    plusFriendId: senderKey,
    templateCode: params.templateCode,
    messages: [
      {
        to: params.to,
        // `content` is required even when `variables` are present (it's
        // used as a fallback if the provider can't render). We compose
        // a deterministic stringified preview so logs and debug traces
        // contain the actual message content.
        content: stringifyVariables(params.variables),
      },
    ],
    variables: [params.variables],
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Most KR providers want either `x-ncp-apigw-api-key` or a Bearer.
      // Bearer is the lower-friction default; deployments can put a
      // reverse proxy in front to translate header names if needed.
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `kakao POST ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`,
    );
  }
  let providerId: string | undefined;
  try {
    const json = (await res.json()) as {
      requestId?: unknown;
      messageId?: unknown;
    };
    const id = json?.requestId ?? json?.messageId;
    if (typeof id === 'string') providerId = id;
  } catch {
    /* non-JSON 2xx is acceptable */
  }
  return { status: 'sent', providerId };
}

/**
 * Render a `variables` map into a one-line preview string for the
 * provider's `content` fallback field + worker logs. Kept deterministic
 * (sorted keys) so two equivalent payloads produce identical strings.
 */
function stringifyVariables(vars: Record<string, string>): string {
  const keys = Object.keys(vars).sort();
  return keys.map((k) => `${k}=${vars[k]}`).join(' | ');
}

/**
 * Send a single KakaoTalk Bizmessage. Throws on transport / non-2xx so
 * BullMQ retries kick in. Returns `{ status: 'skipped' }` when KAKAO is
 * disabled at the env layer.
 */
export async function sendKakao(
  params: SendKakaoParams,
): Promise<SendKakaoResult> {
  const driver = resolveDriver();
  if (driver === 'none') {
    console.log(
      `[kakao] skipped (KAKAO_ENABLED!=1 or KAKAO_DRIVER unset) to=${params.to} template=${params.templateCode}`,
    );
    return { status: 'skipped' };
  }
  return sendViaNcp(params);
}

/** Validate a raw BullMQ job payload. Throws on shape mismatch. */
export function parseKakaoJobPayload(data: unknown): KakaoJobPayload {
  return KakaoJobPayloadSchema.parse(data);
}
