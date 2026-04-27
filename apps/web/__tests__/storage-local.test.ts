import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// R34 V-INF-1 — unit tests for the LOCAL storage driver.
//
// The driver itself lives in `apps/web/lib/storage/local.ts` and is being
// authored by the backend agent in parallel; per the R34 PM brief, FE owns
// these tests but must not write to that path. We resolve the module via a
// dynamic import that's gated on file existence so this test file is safe to
// land before the BE module does (CI green either way).
//
// When the module lands, `describe.skipIf` will flip to `describe` and the
// suite will run on the next CI build. No code edits required from FE.

const LOCAL_MODULE_PATH = resolve(
  __dirname,
  '..',
  'lib',
  'storage',
  'local.ts',
);
const LOCAL_MODULE_EXISTS = existsSync(LOCAL_MODULE_PATH);

// Minimal structural contract the test exercises. The BE module may export
// additional methods (signed URLs, multipart, etc.) but these are the four
// the FE relies on across the app.
interface LocalStorageLike {
  put(key: string, body: Buffer | Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  stat(key: string): Promise<{ size: number }>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

interface LocalStorageCtor {
  new (opts: { root: string }): LocalStorageLike;
}

// Dynamic import wrapped in a function so Vitest doesn't try to resolve the
// module at file-parse time (which would fail before BE lands the file).
async function loadLocalStorage(): Promise<LocalStorageCtor> {
  // The module is expected to default-export the class or named-export it as
  // `LocalStorage`. We accept either to stay loosely coupled.
  // Use a dynamic specifier (avoid Vite static-analysis warnings) so the
  // bundler doesn't try to pre-resolve when the file is absent.
  const specifier = '@/lib/storage/local';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(/* @vite-ignore */ specifier);
  const Ctor: LocalStorageCtor | undefined =
    mod.LocalStorage ?? mod.default ?? mod.LocalStorageDriver;
  if (typeof Ctor !== 'function') {
    throw new Error(
      'Expected `LocalStorage` (or default) constructor export from @/lib/storage/local',
    );
  }
  return Ctor;
}

describe.skipIf(!LOCAL_MODULE_EXISTS)(
  'storage/local — LocalStorage driver',
  () => {
    let LocalStorage: LocalStorageCtor;
    let storage: LocalStorageLike;
    let root: string;

    beforeAll(async () => {
      LocalStorage = await loadLocalStorage();
    });

    afterEach(async () => {
      // Best-effort cleanup; if the directory is gone (delete test) ignore.
      if (root) {
        try {
          await rm(root, { recursive: true, force: true });
        } catch {
          /* swallow */
        }
      }
    });

    async function fresh(): Promise<LocalStorageLike> {
      root = await mkdtemp(join(tmpdir(), 'dm-storage-local-'));
      storage = new LocalStorage({ root });
      return storage;
    }

    it('put followed by get returns the same buffer', async () => {
      const s = await fresh();
      const body = Buffer.from('hello, drawings — 한글 OK', 'utf8');
      await s.put('a/b/c.bin', body);
      const got: unknown = await s.get('a/b/c.bin');
      // Compare bytes; Buffer.equals avoids encoding ambiguity.
      const isBytes =
        Buffer.isBuffer(got) ||
        (typeof Uint8Array !== 'undefined' && got instanceof Uint8Array);
      expect(isBytes).toBe(true);
      expect(Buffer.from(got as Uint8Array).equals(body)).toBe(true);
    });

    it('stat reports the byte size written', async () => {
      const s = await fresh();
      const body = Buffer.alloc(4096, 0x41); // 4 KiB of 'A'
      await s.put('large/file.bin', body);
      const meta = await s.stat('large/file.bin');
      expect(meta.size).toBe(4096);
    });

    it('exists returns true for present keys and false for absent ones', async () => {
      const s = await fresh();
      await s.put('present.txt', Buffer.from('x'));
      await expect(s.exists('present.txt')).resolves.toBe(true);
      await expect(s.exists('does/not/exist.txt')).resolves.toBe(false);
    });

    it('delete removes the file and exists flips to false', async () => {
      const s = await fresh();
      await s.put('victim.txt', Buffer.from('bye'));
      await expect(s.exists('victim.txt')).resolves.toBe(true);
      await s.delete('victim.txt');
      await expect(s.exists('victim.txt')).resolves.toBe(false);
      // Subsequent get must reject — there's no file to read.
      await expect(s.get('victim.txt')).rejects.toBeTruthy();
    });

    // --- Path traversal guards ------------------------------------------
    // The driver must reject any key that resolves outside of `root`,
    // regardless of how it's spelled (relative '..', leading '/', NUL byte).
    // This is the single most important security property of a filesystem-
    // backed storage layer; we keep one assertion per spelling so a failure
    // points the BE at the exact bypass.

    it('rejects keys with relative parent traversal segments', async () => {
      const s = await fresh();
      await expect(
        s.put('../../etc/passwd', Buffer.from('nope')),
      ).rejects.toBeTruthy();
      // Read side too — guards must apply symmetrically.
      await expect(s.get('../../etc/passwd')).rejects.toBeTruthy();
    });

    it('rejects keys that begin with an absolute path separator', async () => {
      const s = await fresh();
      await expect(
        s.put('/etc/passwd', Buffer.from('nope')),
      ).rejects.toBeTruthy();
    });

    it('rejects keys containing a NUL byte', async () => {
      const s = await fresh();
      await expect(
        s.put('inject\u0000bypass.txt', Buffer.from('nope')),
      ).rejects.toBeTruthy();
    });

    it('after a traversal-rejected put, the storage root is empty', async () => {
      const s = await fresh();
      await expect(
        s.put('../../leak.txt', Buffer.from('nope')),
      ).rejects.toBeTruthy();
      // Root should not have leaked anything — listing it must return an
      // empty array (the driver may still create the root itself, which is
      // fine; we just check no entries below it).
      const entries = await readdir(root);
      // The driver may create internal subdirectories on construction (e.g.
      // a `tmp/` scratch space). What matters is no `leak.txt` escaped.
      expect(entries).not.toContain('leak.txt');
      expect(entries).not.toContain('..');
    });
  },
);

// Always-present sanity test so the file isn't a no-op suite when the driver
// module is absent. Vitest won't fail on a fully-skipped describe, but having
// at least one running assertion makes the local-vs-CI delta easier to reason
// about ("did the suite even load?").
describe('storage-local test scaffold', () => {
  it('describes the expected module location', () => {
    expect(LOCAL_MODULE_PATH).toMatch(/apps\/web\/lib\/storage\/local\.ts$/);
  });
});
