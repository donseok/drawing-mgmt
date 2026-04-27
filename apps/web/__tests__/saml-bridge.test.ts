// R37 / A-2 — saml bridge token roundtrip + tamper resistance.
//
// These are pure-function unit tests for the HMAC helpers in lib/saml.ts.
// We don't exercise the full SAML XML pipeline here — that requires fixture
// XML signed against a real IdP cert and lives in a separate integration
// test (apps/web/__tests__/integration/saml.int.test.ts, future).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Profile } from '@node-saml/node-saml';

import {
  mintSamlBridgeToken,
  pickSamlIdentity,
  verifySamlBridgeToken,
} from '@/lib/saml';

const ORIGINAL_SECRET = process.env.AUTH_SECRET;

beforeAll(() => {
  // Bridge HMAC needs AUTH_SECRET; ensure deterministic value for this suite.
  process.env.AUTH_SECRET = 'test-secret-32-char-fixed-aaaaaaaa';
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_SECRET;
});

describe('pickSamlIdentity', () => {
  // Synthesize a Profile-shaped object — the helper only reads attributes,
  // it doesn't care about getAssertionXml/etc.
  function profile(extra: Record<string, unknown>): Profile {
    return {
      issuer: 'idp',
      nameID: 'sub-from-nameid',
      nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
      ...extra,
    } as Profile;
  }

  it('extracts NameID + display name from urn:oid attributes', () => {
    const id = pickSamlIdentity(
      profile({
        'urn:oid:0.9.2342.19200300.100.1.3': 'kim@example.com',
        'urn:oid:2.5.4.3': '김철수',
      }),
    );
    expect(id.sub).toBe('sub-from-nameid');
    expect(id.email).toBe('kim@example.com');
    expect(id.fullName).toBe('김철수');
  });

  it('extracts via xmlsoap claims (Microsoft AD FS shape)', () => {
    const id = pickSamlIdentity(
      profile({
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress':
          'park@example.com',
        'http://schemas.microsoft.com/identity/claims/displayname': '박영호',
      }),
    );
    expect(id.email).toBe('park@example.com');
    expect(id.fullName).toBe('박영호');
  });

  it('builds fullName from givenName + sn when no cn', () => {
    const id = pickSamlIdentity(
      profile({
        'urn:oid:2.5.4.42': 'Jerry',
        'urn:oid:2.5.4.4': 'Lee',
      }),
    );
    expect(id.fullName).toBe('Jerry Lee');
  });

  it('falls back to email local-part for username', () => {
    const id = pickSamlIdentity(
      profile({
        'urn:oid:0.9.2342.19200300.100.1.3': 'jerry@example.com',
      }),
    );
    expect(id.username).toBe('jerry');
  });

  it('throws when nothing resolves to a sub', () => {
    expect(() =>
      pickSamlIdentity({
        issuer: 'idp',
        // No nameID, no fallback claims.
      } as Profile),
    ).toThrow(/missing NameID/);
  });
});

describe('saml bridge token', () => {
  it('mints a token that verifies back to the same userId', () => {
    const token = mintSamlBridgeToken('user_abc123');
    expect(verifySamlBridgeToken(token)).toBe('user_abc123');
  });

  it('rejects an empty / malformed token', () => {
    expect(verifySamlBridgeToken('')).toBeNull();
    expect(verifySamlBridgeToken('no-dot')).toBeNull();
    expect(verifySamlBridgeToken('a.b.c')).toBeNull();
  });

  it('rejects a token with a tampered body', () => {
    const token = mintSamlBridgeToken('user_abc123');
    const [, sig] = token.split('.');
    const tampered = `${Buffer.from('{"uid":"attacker","exp":' + (Date.now() + 60000) + '}').toString('base64url')}.${sig}`;
    expect(verifySamlBridgeToken(tampered)).toBeNull();
  });

  it('rejects a token with a tampered signature', () => {
    const token = mintSamlBridgeToken('user_abc123');
    const [body] = token.split('.');
    const tampered = `${body}.${'x'.repeat(43)}`; // 43 base64url chars = 32 bytes
    expect(verifySamlBridgeToken(tampered)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = mintSamlBridgeToken('user_abc123');
    process.env.AUTH_SECRET = 'a-different-secret-32-char-bbbbbbbb';
    expect(verifySamlBridgeToken(token)).toBeNull();
    process.env.AUTH_SECRET = 'test-secret-32-char-fixed-aaaaaaaa';
  });

  it('rejects a token whose body decodes to non-JSON', () => {
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const key = crypto
      .createHash('sha256')
      .update(`saml-bridge:${process.env.AUTH_SECRET}`)
      .digest();
    const body = Buffer.from('not json', 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
    expect(verifySamlBridgeToken(`${body}.${sig}`)).toBeNull();
  });

  it('rejects an expired token', () => {
    // Mint a token with a stale expiry by re-implementing the format manually
    // (we don't expose a backdoor in production code).
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const key = crypto
      .createHash('sha256')
      .update(`saml-bridge:${process.env.AUTH_SECRET}`)
      .digest();
    const body = Buffer.from(
      JSON.stringify({ uid: 'user_abc', exp: Date.now() - 1000 }),
      'utf8',
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
    const expired = `${body}.${sig}`;
    expect(verifySamlBridgeToken(expired)).toBeNull();
  });
});
