// R34 V-INF-1 — wire shapes for the /admin/storage surface.
//
// Mirrors api_contract.md §6 (storage admin endpoints). Until the BE lands
// `apps/web/lib/storage/{local,s3,index}.ts` we treat this file as the FE-side
// expected contract; if the BE ships slightly different field names the page
// can adapt with a thin adapter without rippling through component code.
//
// Endpoints:
//   GET  /api/v1/admin/storage/info  → StorageInfoDTO
//   POST /api/v1/admin/storage/test  → StorageTestResultDTO

/** Active storage driver. LOCAL = filesystem under STORAGE_LOCAL_ROOT. */
export type StorageDriver = 'LOCAL' | 'S3';

/** Connection probe state. UNKNOWN before the first probe completes. */
export type StorageConnectionState = 'OK' | 'ERROR' | 'UNKNOWN';

/**
 * Aggregate storage stats. `totalBytes` is serialized as a string by the API
 * so very large repositories survive JSON.stringify cleanly (BigInt). The UI
 * coerces with Number() at format time.
 */
export interface StorageStatsDTO {
  /** Total number of stored objects (attachments + thumbnails + previews). */
  totalObjects: number;
  /** Sum of stored object sizes in bytes (decimal string for BigInt safety). */
  totalBytes: string | number;
  /** Number of objects added in the last 24h (recent throughput indicator). */
  recentObjects: number;
}

/** S3-specific runtime config exposed to the admin (credentials are masked). */
export interface S3ConfigDTO {
  endpoint: string | null;
  region: string | null;
  bucket: string;
  /** Always presented as `••••` placeholders or last-4 — never the real key. */
  accessKeyMasked: string | null;
  /** True if a SecretAccessKey is configured server-side (existence only). */
  hasSecretKey: boolean;
  /** Force path-style addressing (typical for MinIO/Ceph). */
  forcePathStyle: boolean;
}

/** LOCAL-specific runtime config (root path, free space hint if available). */
export interface LocalConfigDTO {
  /** Absolute path on the server filesystem. Read-only display. */
  root: string;
  /** Free bytes on the volume hosting `root`, or null if not measurable. */
  freeBytes: string | number | null;
}

/**
 * Combined info envelope returned by GET /admin/storage/info.
 *
 * `connection` reflects the most recent passive probe (server may run a quick
 * stat() / HeadBucket on each request, or cache the prior /test result for a
 * short window — either is acceptable per spec).
 */
export interface StorageInfoDTO {
  driver: StorageDriver;
  connection: StorageConnectionState;
  /** Optional human-readable note when `connection === 'ERROR'`. */
  connectionMessage: string | null;
  /** Driver-specific config (exactly one of `local` / `s3` populated). */
  local: LocalConfigDTO | null;
  s3: S3ConfigDTO | null;
  stats: StorageStatsDTO;
  /** ISO timestamp the server captured this snapshot. */
  capturedAt: string;
}

/**
 * Result of POST /admin/storage/test — actively performs put → stat → delete
 * on a probe key (e.g. `__healthcheck/<uuid>`) and reports each phase.
 *
 * `latencyMs` is end-to-end (put + stat + delete combined) so the admin gets
 * a single quick-feel number to compare LOCAL vs S3.
 */
export interface StorageTestResultDTO {
  ok: boolean;
  driver: StorageDriver;
  /** When `ok = false` this carries the underlying error message. */
  message: string | null;
  /** Round-trip latency for the full probe sequence, in milliseconds. */
  latencyMs: number;
  /** ISO timestamp the probe ran. */
  testedAt: string;
}
