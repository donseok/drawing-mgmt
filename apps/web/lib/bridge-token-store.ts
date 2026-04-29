// Consume-once store for SAML/MFA bridge token jti claims.
//
// Pure HMAC bridge tokens are stateless — within their TTL they can be
// replayed any number of times. This store flips that to single-use by
// remembering each jti for the bridge's TTL: the first verify+consume
// succeeds, every subsequent attempt with the same jti is rejected.
//
// Redis is preferred (multi-replica safe). When Redis is unavailable we
// fall back to an in-memory Set with the same TTL — same semantics on a
// single replica, weakly degraded across replicas (an attacker who happens
// to hit a different replica could still replay). That tradeoff matches
// the existing `lib/rate-limit.ts` pattern.

import IORedis, { type Redis } from 'ioredis';

type RedisState = Redis | 'unavailable' | null;
let redisSingleton: RedisState = null;

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
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    let warned = false;
    r.on('error', (err) => {
      if (!warned) {
        warned = true;
        // eslint-disable-next-line no-console
        console.warn('[bridge-token-store] redis error, falling back to in-memory:', err.message);
      }
    });
    redisSingleton = r;
    return r;
  } catch {
    redisSingleton = 'unavailable';
    return null;
  }
}

interface MemEntry {
  expiresAt: number;
}
const memStore = new Map<string, MemEntry>();
let lastSweep = 0;
function sweepMem(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of memStore) {
    if (v.expiresAt <= now) memStore.delete(k);
  }
}

/**
 * Mark a bridge `jti` as consumed. Returns `true` on the first call (caller
 * should proceed) and `false` on every subsequent call within `ttlSec`
 * (caller should reject as a replay).
 */
export async function consumeBridgeJti(jti: string, ttlSec: number): Promise<boolean> {
  if (!jti) return false;

  const r = getRedis();
  if (r && r.status === 'ready') {
    try {
      const key = `bridge-jti:${jti}`;
      const set = await r.set(key, '1', 'EX', ttlSec, 'NX');
      return set === 'OK';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[bridge-token-store] redis op failed, falling back to in-memory:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const now = Date.now();
  sweepMem(now);
  const existing = memStore.get(jti);
  if (existing && existing.expiresAt > now) return false;
  memStore.set(jti, { expiresAt: now + ttlSec * 1000 });
  return true;
}
