// R50 / FIND-007 — Redis-backed CacheProvider for @node-saml/node-saml.
//
// Background:
//   `validateInResponseTo: 'always'` makes node-saml verify that every
//   incoming SAMLResponse references an InResponseTo we just minted. To do
//   that the library asks a CacheProvider to remember the request id we
//   issued at /login time, then look it up at /acs time. The default
//   InMemoryCacheProvider only works for a single process — across multiple
//   web replicas the request mints on instance A and the response lands on
//   instance B, so the lookup misses and the IdP response is rejected.
//
//   This module ships a Redis-backed provider keyed `saml:rid:<requestId>`
//   with a 10-minute TTL (covers the IdP redirect round-trip with margin
//   over the 5-minute clock skew we accept). When REDIS_URL is unset we
//   return `null` from getRedis() and let the caller decide — `saml.ts`
//   degrades to `validateInResponseTo: 'never'` (i.e. the previous behavior)
//   so dev environments without Redis still work.
//
// API shape:
//   `@node-saml/node-saml` v5 exposes the provider as three async methods —
//   `saveAsync(key, value): Promise<CacheItem | null>` (returns null when
//   the key already existed; this prevents replay-by-overwrite),
//   `getAsync(key): Promise<string | null>`,
//   `removeAsync(key): Promise<string | null>`.
//   We follow the in-memory reference impl: `saveAsync` uses Redis `SET`
//   with `NX` + `EX` so only the first write succeeds; `getAsync` is a
//   plain `GET`; `removeAsync` is a `DEL` that returns the key on success.

import IORedis, { type Redis } from 'ioredis';
import type { CacheItem, CacheProvider } from '@node-saml/node-saml';

/** TTL in seconds. SAML responses are typically valid for ~5 minutes; 10
 * minutes covers the IdP redirect + acceptedClockSkewMs (5min) + headroom. */
const TTL_SEC = 10 * 60;

/** Redis key prefix — keeps SAML state separate from rate-limit (`rl:`),
 * BullMQ (`bull:`), etc. */
const KEY_PREFIX = 'saml:rid:';

let redisSingleton: Redis | 'unavailable' | null = null;

function getRedis(): Redis | null {
  if (redisSingleton === 'unavailable') return null;
  if (redisSingleton) return redisSingleton;

  const url = process.env.REDIS_URL;
  if (!url) {
    redisSingleton = 'unavailable';
    return null;
  }

  try {
    const r = new IORedis(url, {
      // Auth flow is on the request hot path — fail fast rather than
      // queue retries through the ACS validator.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    let warned = false;
    r.on('error', (err) => {
      if (!warned) {
        warned = true;
        // eslint-disable-next-line no-console
        console.warn('[saml-cache] redis error:', err.message);
      }
    });
    redisSingleton = r;
    return r;
  } catch {
    redisSingleton = 'unavailable';
    return null;
  }
}

/**
 * Build the prefixed Redis key. Exported only for tests; production code
 * never calls this directly.
 */
export function samlCacheKey(requestId: string): string {
  return `${KEY_PREFIX}${requestId}`;
}

/**
 * Redis-backed CacheProvider compatible with @node-saml/node-saml v5.
 *
 * Behavior matches the in-memory reference implementation:
 *   - saveAsync: only the FIRST write for a key succeeds (returns CacheItem);
 *                subsequent writes return null. Implemented via `SET NX EX`.
 *   - getAsync: plain GET; missing key = null.
 *   - removeAsync: DEL; returns the key when it existed, null otherwise.
 *
 * If Redis is unavailable we degrade to "never seen this key" — `getAsync`
 * returns null so node-saml will reject the response. This is the correct
 * fail-closed behavior; if the operator wants the lenient mode they should
 * leave REDIS_URL unset, which makes saml.ts itself pick
 * `validateInResponseTo: 'never'`.
 */
export const samlCacheProvider: CacheProvider = {
  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    const r = getRedis();
    if (!r || r.status !== 'ready') return null;
    try {
      const createdAt = Date.now();
      // NX = only set if not already present. This matches the in-memory
      // provider's "if (!this.cacheKeys[key])" branch — second writes for
      // the same key are intentionally no-ops, which is what node-saml
      // expects for replay protection.
      const ok = await r.set(samlCacheKey(key), value, 'EX', TTL_SEC, 'NX');
      if (ok !== 'OK') return null;
      return { value, createdAt };
    } catch {
      return null;
    }
  },

  async getAsync(key: string): Promise<string | null> {
    const r = getRedis();
    if (!r || r.status !== 'ready') return null;
    try {
      return await r.get(samlCacheKey(key));
    } catch {
      return null;
    }
  },

  async removeAsync(key: string | null): Promise<string | null> {
    if (key == null) return null;
    const r = getRedis();
    if (!r || r.status !== 'ready') return null;
    try {
      const removed = await r.del(samlCacheKey(key));
      return removed > 0 ? key : null;
    } catch {
      return null;
    }
  },
};
