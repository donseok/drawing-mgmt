// Storage factory — picks LocalStorage or S3Storage based on env.
//
// Routes and admin endpoints call `getStorage()`; the singleton is built on
// first use and reused thereafter. Tests can call `resetStorageForTest()`
// to drop the cached instance.
//
// Env vars (mirrored in .env.example):
//   STORAGE_DRIVER=local|s3   (default: local)
//   FILE_STORAGE_ROOT=...     (local only, default ./.data/files)
//   S3_ENDPOINT=...           (s3 only)
//   S3_REGION=...             (s3 only, default us-east-1)
//   S3_BUCKET=...             (s3 only, required)
//   S3_ACCESS_KEY_ID=...      (s3 only)
//   S3_SECRET_ACCESS_KEY=...  (s3 only)
//   S3_FORCE_PATH_STYLE=1     (MinIO; default 0)
//
// Why lazy:
//   - Build steps (`next build`) shouldn't fail because S3_BUCKET isn't set
//     in CI — they don't actually invoke `getStorage()`. Only routes that
//     touch storage construct the client.
//   - `next dev` re-imports modules across HMR; lazy init keeps a single
//     Client per process across reloads (cached on globalThis).

import path from 'node:path';
import type { Storage, StorageDriverConfig } from '@drawing-mgmt/shared/storage';
import { LocalStorage } from './local';
import { S3Storage } from './s3';

declare global {
  // eslint-disable-next-line no-var
  var __DM_STORAGE__: { instance?: Storage; driver?: 'local' | 's3' } | undefined;
}

function readConfigFromEnv(): StorageDriverConfig {
  const raw = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  const driver: 'local' | 's3' = raw === 's3' ? 's3' : 'local';
  if (driver === 'local') {
    const root = process.env.FILE_STORAGE_ROOT ?? './.data/files';
    return {
      driver,
      rootPath: path.isAbsolute(root) ? root : path.resolve(process.cwd(), root),
    };
  }
  return {
    driver,
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
    forcePathStyle:
      (process.env.S3_FORCE_PATH_STYLE ?? '').toLowerCase() === '1' ||
      (process.env.S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true',
  };
}

function buildStorage(config: StorageDriverConfig): Storage {
  if (config.driver === 's3') {
    if (!config.bucket) {
      throw new Error(
        'storage: S3 driver selected but S3_BUCKET is not set. Set STORAGE_DRIVER=local for filesystem mode.',
      );
    }
    return new S3Storage({
      bucket: config.bucket,
      region: config.region ?? 'us-east-1',
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: config.forcePathStyle,
    });
  }
  return new LocalStorage({
    rootPath: config.rootPath ?? path.resolve(process.cwd(), './.data/files'),
  });
}

/**
 * Lazily-built singleton. Cached on `globalThis` so HMR in dev doesn't
 * leak per-reload S3Clients.
 */
export function getStorage(): Storage {
  const slot = (globalThis.__DM_STORAGE__ ??= {});
  if (slot.instance) return slot.instance;
  const config = readConfigFromEnv();
  slot.instance = buildStorage(config);
  slot.driver = config.driver;
  return slot.instance;
}

/** Returns the active driver name without forcing instantiation. */
export function getStorageDriver(): 'local' | 's3' {
  const slot = globalThis.__DM_STORAGE__;
  if (slot?.driver) return slot.driver;
  const raw = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  return raw === 's3' ? 's3' : 'local';
}

/**
 * Driver-specific descriptive metadata for the admin/storage info endpoint.
 * Pulls fields directly from env so we don't expose secrets — only public
 * config (driver name, bucket, endpoint, root path).
 */
export function getStorageInfo(): {
  driver: 'local' | 's3';
  rootPath?: string;
  bucket?: string;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
} {
  const cfg = readConfigFromEnv();
  if (cfg.driver === 'local') {
    return { driver: 'local', rootPath: cfg.rootPath };
  }
  return {
    driver: 's3',
    bucket: cfg.bucket,
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
  };
}

/** Test-only — drops the cached singleton so a fresh env can be picked up. */
export function resetStorageForTest(): void {
  globalThis.__DM_STORAGE__ = undefined;
}

export { LocalStorage } from './local';
export { S3Storage } from './s3';
