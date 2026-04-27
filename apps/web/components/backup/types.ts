// R33 D-5 — wire shapes for the /admin/backups surface.
//
// Mirrors api_contract.md §4 (Backup model + admin endpoints). Kept inside
// `components/backup/` so the page and the dialog share the same DTO without
// reaching into a server-side schema. When we move to a shared zod schema
// (packages/shared) we can swap the alias type-only.

export type BackupKind = 'POSTGRES' | 'FILES';
export type BackupStatus = 'RUNNING' | 'DONE' | 'FAILED';

/**
 * Single backup history row. `sizeBytes` is serialized as a string by the API
 * (BigInt does not survive JSON.stringify cleanly) — we leave both forms in
 * the union so the UI can `Number()` the string when present.
 */
export interface BackupRowDTO {
  id: string;
  kind: BackupKind;
  status: BackupStatus;
  storagePath: string | null;
  sizeBytes: string | number | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Server-computed convenience: ms between startedAt and finishedAt. */
  durationMs: number | null;
}

export interface BackupListEnvelope {
  ok: true;
  data: BackupRowDTO[];
  meta: {
    nextCursor: string | null;
    /** Optional aggregate counters; unused today but reserved by contract. */
    runningCount?: number;
  };
}

export interface BackupRunResponse {
  id: string;
  kind: BackupKind;
  status: BackupStatus;
}
