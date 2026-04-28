// SHA-256 helper checks against canonical vectors.

import { describe, expect, it } from 'vitest';
import { sha256OfBuffer } from '../src/checksum.js';

describe('sha256OfBuffer', () => {
  it('matches the empty-string canonical vector', () => {
    expect(sha256OfBuffer(Buffer.from(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
  it('matches the "abc" canonical vector', () => {
    expect(sha256OfBuffer(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
