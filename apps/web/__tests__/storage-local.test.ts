// LocalStorage driver — smoke + traversal tests.
//
// Why this lives here: R34 V-INF-1 introduces an abstraction layer that all
// file I/O routes go through. The cheapest insurance against regressions is
// an in-process round-trip on the real filesystem driver — put → stat →
// list → get → delete — plus negative cases for the path-traversal guard
// which is the most security-sensitive piece of the code.
//
// Tests use a per-suite scratch directory under `os.tmpdir()` so they don't
// clobber the dev `.data/files` tree. Each `it` cleans up its own subtree.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorage } from '@/lib/storage/local';
import {
  StorageKeyError,
  StorageNotFoundError,
} from '@drawing-mgmt/shared/storage';

let root: string;
let storage: LocalStorage;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'dm-storage-test-'));
  storage = new LocalStorage({ rootPath: root });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('LocalStorage round-trip', () => {
  it('put + stat + get + delete (Buffer body)', async () => {
    const key = 'att1/source.dxf';
    const body = Buffer.from('hello world');
    const putRes = await storage.put(key, body, { contentType: 'image/vnd.dxf' });
    expect(putRes).toEqual({ key, size: body.byteLength });

    const stat = await storage.stat(key);
    expect(stat?.size).toBe(body.byteLength);

    expect(await storage.exists(key)).toBe(true);

    const got = await storage.get(key);
    const chunks: Buffer[] = [];
    for await (const c of got.stream as AsyncIterable<Buffer>) chunks.push(c);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello world');

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.stat(key)).toBeNull();
  });

  it('put + get with stream body', async () => {
    const key = 'att2/preview.dxf';
    const stream = Readable.from([Buffer.from('chunk-a'), Buffer.from('chunk-b')]);
    const putRes = await storage.put(key, stream);
    expect(putRes.size).toBe('chunk-a'.length + 'chunk-b'.length);
    const got = await storage.get(key);
    const chunks: Buffer[] = [];
    for await (const c of got.stream as AsyncIterable<Buffer>) chunks.push(c);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('chunk-achunk-b');
    await storage.delete(key);
  });

  it('get throws StorageNotFoundError for missing key', async () => {
    await expect(storage.get('missing/file.bin')).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
  });

  it('delete is idempotent for missing keys', async () => {
    await expect(storage.delete('never-existed/x.bin')).resolves.toBeUndefined();
  });

  it('list returns objects under a prefix', async () => {
    await storage.put('grp/a.txt', Buffer.from('a'));
    await storage.put('grp/sub/b.txt', Buffer.from('bb'));
    await storage.put('other/c.txt', Buffer.from('ccc'));

    const inGrp = await storage.list('grp/', { limit: 100 });
    const keys = inGrp.items.map((i) => i.key).sort();
    expect(keys).toEqual(['grp/a.txt', 'grp/sub/b.txt']);

    const total = await storage.list('', { limit: 100 });
    expect(total.items.length).toBeGreaterThanOrEqual(3);

    await storage.delete('grp/a.txt');
    await storage.delete('grp/sub/b.txt');
    await storage.delete('other/c.txt');
  });
});

describe('LocalStorage path-traversal guard', () => {
  it('rejects keys with .. segments', async () => {
    await expect(
      storage.put('../escape', Buffer.from('x')),
    ).rejects.toBeInstanceOf(StorageKeyError);
    await expect(
      storage.put('foo/../bar', Buffer.from('x')),
    ).rejects.toBeInstanceOf(StorageKeyError);
  });

  it('rejects absolute keys', async () => {
    await expect(
      storage.put('/etc/passwd', Buffer.from('x')),
    ).rejects.toBeInstanceOf(StorageKeyError);
  });

  it('rejects keys with backslashes', async () => {
    await expect(
      storage.put('foo\\bar', Buffer.from('x')),
    ).rejects.toBeInstanceOf(StorageKeyError);
  });

  it('rejects empty keys', async () => {
    await expect(storage.put('', Buffer.from('x'))).rejects.toBeInstanceOf(
      StorageKeyError,
    );
  });

  it('rejects illegal characters', async () => {
    await expect(
      storage.put('foo bar.txt', Buffer.from('x')),
    ).rejects.toBeInstanceOf(StorageKeyError);
    await expect(
      storage.put('foo;bar', Buffer.from('x')),
    ).rejects.toBeInstanceOf(StorageKeyError);
  });

  it('accepts canonical attachment keys', async () => {
    const k1 = 'a1b2c3-uuid/source.dwg';
    const k2 = 'a1b2c3-uuid/preview.dxf';
    const k3 = 'a1b2c3-uuid/thumbnail.png';
    await storage.put(k1, Buffer.from('1'));
    await storage.put(k2, Buffer.from('2'));
    await storage.put(k3, Buffer.from('3'));
    expect(await storage.exists(k1)).toBe(true);
    expect(await storage.exists(k2)).toBe(true);
    expect(await storage.exists(k3)).toBe(true);
    await storage.delete(k1);
    await storage.delete(k2);
    await storage.delete(k3);
  });
});
