import { z } from 'zod';

// ConversionJob 큐 페이로드 (apps/web → apps/worker)
export const ConversionJobPayloadSchema = z.object({
  jobId: z.string(),
  attachmentId: z.string(),
  storagePath: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  outputs: z.array(z.enum(['pdf', 'pdf-color', 'dxf', 'svg', 'thumbnail'])).default(['pdf', 'dxf', 'thumbnail']),
});

export type ConversionJobPayload = z.infer<typeof ConversionJobPayloadSchema>;

export const ConversionResultSchema = z.object({
  jobId: z.string(),
  attachmentId: z.string(),
  status: z.enum(['DONE', 'FAILED']),
  pdfPath: z.string().optional(),
  dxfPath: z.string().optional(),
  svgPath: z.string().optional(),
  thumbnailPath: z.string().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().optional(),
});

export type ConversionResult = z.infer<typeof ConversionResultSchema>;

export const CONVERSION_QUEUE_NAME = 'dwg-conversion';

// ─────────────────────────────────────────────────────────────
// R31 P-1 — PDF print queue.
//
// Separate BullMQ queue (`pdf-print`) from the main DWG→DXF/thumbnail
// pipeline. Backend enqueues here when a user hits "Print" on an attachment;
// the worker (apps/worker/src/index.ts) consumes, runs the DXF→PDF mapper
// (apps/worker/src/pdf.ts), and writes a PDF under
// `<FILE_STORAGE_ROOT>/<attachmentId>/print-<ctb>-<pageSize>.pdf`.
//
// We reuse the `ConversionJob` row for status (PENDING/PROCESSING/DONE/
// FAILED) — the worker bumps `status` and `errorMessage` exactly like the
// main pipeline. The payload's `dxfPath` is best-effort: when present the
// worker skips re-running ODA/LibreDWG and just renders the PDF; when
// missing the worker falls through to converting from `storagePath` (DWG)
// first.
// ─────────────────────────────────────────────────────────────

export const PDF_PRINT_QUEUE_NAME = 'pdf-print';

export const PdfCtbSchema = z.enum(['mono', 'color-a3']);
export type PdfCtb = z.infer<typeof PdfCtbSchema>;

export const PdfPageSizeSchema = z.enum(['A4', 'A3']);
export type PdfPageSize = z.infer<typeof PdfPageSizeSchema>;

export const PdfPrintJobPayloadSchema = z.object({
  /** ConversionJob row id — used to update PROCESSING/DONE/FAILED status. */
  jobId: z.string(),
  /** Owning Attachment id — used to compose the output directory. */
  attachmentId: z.string(),
  /**
   * Source DWG path. Worker uses this only when `dxfPath` is missing and a
   * fresh DXF needs to be produced before rendering the PDF.
   */
  storagePath: z.string(),
  /**
   * Pre-converted DXF path, when the attachment already has one cached
   * (set by the main pipeline). When omitted the worker will run
   * ODA→LibreDWG before rendering.
   */
  dxfPath: z.string().optional(),
  filename: z.string(),
  mimeType: z.string(),
  /** mono = black & white, color-a3 = ACI palette pass-through. */
  ctb: PdfCtbSchema.default('mono'),
  /** Output page size. */
  pageSize: PdfPageSizeSchema.default('A4'),
});

export type PdfPrintJobPayload = z.infer<typeof PdfPrintJobPayloadSchema>;

export const PdfPrintResultSchema = z.object({
  jobId: z.string(),
  attachmentId: z.string(),
  status: z.enum(['DONE', 'FAILED']),
  pdfPath: z.string().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().optional(),
});

export type PdfPrintResult = z.infer<typeof PdfPrintResultSchema>;

// ─────────────────────────────────────────────────────────────
// R33 D-5 — Backup queue.
//
// Separate BullMQ queue (`backup`) for periodic / on-demand DR snapshots.
// Two job kinds:
//
//   - POSTGRES : `pg_dump --format=custom --compress=9` of $DATABASE_URL into a
//                gzipped archive under `<BACKUP_ROOT>/postgres-<ts>.dump.gz`.
//   - FILES    : `tar -czf` of $FILE_STORAGE_ROOT into
//                `<BACKUP_ROOT>/files-<ts>.tar.gz`.
//
// Backend (apps/web) is responsible for the `Backup` row schema, the admin
// REST endpoints, and the per-job retention policy. The worker only:
//   1) reads the `Backup` row by id,
//   2) marks it RUNNING,
//   3) runs the appropriate subprocess (pg_dump / tar),
//   4) writes back DONE/FAILED + storagePath + sizeBytes,
//   5) (DONE only) prunes archives older than `retentionDays` from
//      `<BACKUP_ROOT>` for the matching kind prefix.
//
// GPL posture: pg_dump (PostgreSQL BSD-style), tar/gzip (GNU/standard Unix
// shipped with the base image) — no GPL transitive deps in the npm tree.
// ─────────────────────────────────────────────────────────────

export const BACKUP_QUEUE_NAME = 'backup';

export const BackupKindSchema = z.enum(['POSTGRES', 'FILES']);
export type BackupKind = z.infer<typeof BackupKindSchema>;

export const BackupJobPayloadSchema = z.object({
  /** Backup row id — used to update RUNNING/DONE/FAILED status. */
  backupId: z.string(),
  kind: BackupKindSchema,
  /**
   * Override the worker's BACKUP_RETENTION_DAYS for this specific job. Useful
   * for one-shot backups operators want to keep longer than the default
   * rolling window. Worker still honors a non-negative number; <= 0 disables
   * pruning for this job.
   */
  retentionDaysOverride: z.number().int().optional(),
});

export type BackupJobPayload = z.infer<typeof BackupJobPayloadSchema>;

export const BackupResultSchema = z.object({
  backupId: z.string(),
  kind: BackupKindSchema,
  status: z.enum(['DONE', 'FAILED']),
  storagePath: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  prunedCount: z.number().int().nonnegative().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().optional(),
});

export type BackupResult = z.infer<typeof BackupResultSchema>;

// ─────────────────────────────────────────────────────────────
// R35 N-1 — Mail queue.
//
// Separate BullMQ queue (`mail`) for outbound email notifications. Backend
// (apps/web) enqueues a job whenever it creates a Notification row for a
// user whose `notifyByEmail` is true and `MAIL_ENABLED=1`. The worker
// (apps/worker/src/mail-worker.ts) consumes the job and runs nodemailer
// SMTP send.
//
// Design notes:
//   - Notification row creation lives on the web side (R29). The worker is
//     pure side-effect — it does NOT mutate the row. Successful sends are
//     logged; failures are retried by BullMQ (3 attempts + exp backoff).
//   - `notificationId` is optional so this queue can also be used for
//     transactional, non-notification emails later (e.g. password reset)
//     without schema changes.
//   - `text` is required (plain-text body). `html` is optional — when both
//     are present the SMTP server lets the recipient pick.
//   - `MAIL_ENABLED=0` short-circuits both the enqueue side (web) and the
//     worker bootstrap (worker doesn't start the consumer), so the queue
//     stays empty in dev / CI.
//
// License posture: nodemailer is MIT (web/lib/mail.ts and the worker's own
// transport sit on the same library; no GPL transitive deps).
// ─────────────────────────────────────────────────────────────

export const MAIL_QUEUE_NAME = 'mail';

export const MailJobPayloadSchema = z.object({
  /**
   * Optional Notification row id this email corresponds to. Set when the
   * email is a notification fan-out from R29's `enqueueNotification`. Left
   * undefined for ad-hoc transactional sends (password reset, invite, …).
   */
  notificationId: z.string().optional(),
  /** Recipient email address. Validated as RFC 5322-ish at the edge. */
  to: z.string().email(),
  /** Subject line (UTF-8). */
  subject: z.string().min(1),
  /** Plain-text body. Required even when `html` is present (a11y/fallback). */
  text: z.string(),
  /** Optional HTML body. */
  html: z.string().optional(),
});

export type MailJobPayload = z.infer<typeof MailJobPayloadSchema>;

export const MailResultSchema = z.object({
  notificationId: z.string().optional(),
  to: z.string(),
  status: z.enum(['SENT', 'SKIPPED', 'FAILED']),
  /** Underlying SMTP message id when available. */
  messageId: z.string().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().optional(),
});

export type MailResult = z.infer<typeof MailResultSchema>;

// ─────────────────────────────────────────────────────────────
// R36 V-INF-3 — Virus scan queue.
//
// Separate BullMQ queue (`virus-scan`) for ClamAV scans of newly uploaded
// attachments. Backend (apps/web) enqueues a job whenever an Attachment row
// is created in either `POST /api/v1/objects/{id}/attachments` (R21) or
// `POST /api/v1/uploads/{id}/finalize` (R31). The worker
// (apps/worker/src/scan-worker.ts, owned by viewer-engineer) consumes and
// runs `clamscan` (or clamd TCP) on the source file.
//
// Lifecycle on Attachment.virusScanStatus:
//   PENDING  — row created, no worker pickup yet
//   SCANNING — worker started
//   CLEAN    — exit 0, no signature
//   INFECTED — exit 1 + signature recorded
//   SKIPPED  — CLAMAV_ENABLED=0 or binary unavailable
//   FAILED   — exit 2 / I/O / unexpected error (admin retry-able)
//
// License posture: ClamAV (GPL) is invoked via subprocess only — no JS
// bindings. Same GPL-isolation pattern as LibreDWG (apps/worker/src/libredwg.ts).
// ─────────────────────────────────────────────────────────────

export const VIRUS_SCAN_QUEUE_NAME = 'virus-scan';

export const VirusScanJobPayloadSchema = z.object({
  /** Attachment row id whose source file should be scanned. */
  attachmentId: z.string(),
  /**
   * Storage key for the source file (e.g. `<attachmentId>/source.dwg`).
   * Worker uses this to fetch bytes via the storage abstraction so MinIO/S3
   * deployments work without changing the worker.
   */
  storagePath: z.string(),
  /** Original filename — used for logging + signature reporting. */
  filename: z.string(),
  /**
   * File size in bytes. Logged so admins can spot huge files that exceed
   * the ClamAV stream size cap and need a config bump.
   */
  size: z.number().int().nonnegative().optional(),
});

export type VirusScanJobPayload = z.infer<typeof VirusScanJobPayloadSchema>;

export const VirusScanResultSchema = z.object({
  attachmentId: z.string(),
  status: z.enum(['CLEAN', 'INFECTED', 'SKIPPED', 'FAILED']),
  /** ClamAV signature name when status === 'INFECTED'. */
  signature: z.string().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().optional(),
});

export type VirusScanResult = z.infer<typeof VirusScanResultSchema>;

// ─────────────────────────────────────────────────────────────
// R38 N-2 — SMS queue.
//
// Mirrors R35's mail queue exactly. Backend (apps/web) enqueues a job
// from `enqueueNotification` (extended in R38) for any user whose
// `notifyBySms=true` AND has a non-empty `phoneNumber` AND
// `SMS_ENABLED=1`. The worker (apps/worker/src/sms-worker.ts) consumes
// and runs the configured driver (Twilio Apache 2.0 SDK or generic HTTP).
//
// Why fan-out at enqueue time (vs a single notification queue with
// per-channel switches): keeps the BullMQ retry policy independent —
// SMTP failures shouldn't stall SMS, and vice versa. The price is one
// extra queue + worker, paid once per channel.
//
// License posture: twilio is Apache 2.0; generic HTTP uses the Node 22
// global `fetch`. No GPL/AGPL transitive deps in the npm tree.
// ─────────────────────────────────────────────────────────────

export const SMS_QUEUE_NAME = 'sms';

export const SmsJobPayloadSchema = z.object({
  /**
   * Optional Notification row id this SMS corresponds to. Set when the
   * send is a notification fan-out from R29's `enqueueNotification`.
   * Left undefined for ad-hoc transactional sends (e.g. 2FA later).
   */
  notificationId: z.string().optional(),
  /**
   * Recipient phone number in E.164-ish format (`^\+?[0-9-]{8,20}$`).
   * The web layer trims/validates at enqueue time so the worker can
   * pass it straight through to Twilio / the generic HTTP endpoint.
   */
  to: z.string().min(1),
  /**
   * SMS body. Plain text only; carriers strip rich content. We let the
   * caller worry about 70 / 160 / 1600 char segmentation — the worker
   * just forwards.
   */
  text: z.string().min(1),
});

export type SmsJobPayload = z.infer<typeof SmsJobPayloadSchema>;

export const SmsResultSchema = z.object({
  notificationId: z.string().optional(),
  to: z.string(),
  status: z.enum(['SENT', 'SKIPPED', 'FAILED']),
  /** Underlying provider message id (Twilio SID, generic provider id). */
  providerId: z.string().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().optional(),
});

export type SmsResult = z.infer<typeof SmsResultSchema>;

// ─────────────────────────────────────────────────────────────
// R38 N-2 — KakaoTalk Bizmessage (알림톡) queue.
//
// Korean carrier-grade transactional messaging via pre-approved
// templates. Backend enqueues from `enqueueNotification` when the
// target user's `notifyByKakao=true` AND `phoneNumber` is set AND
// `KAKAO_ENABLED=1`.
//
// Unlike SMS we send by `templateCode` + `variables` (the actual
// rendered text is server-side at the provider). The worker driver
// is intentionally stub-friendly for this round — see
// `apps/worker/src/kakao.ts` — because templates require provider
// pre-registration which dev/CI can't do.
//
// License posture: no SDK — driver uses Node 22 global `fetch`
// against the configured KAKAO_API_ENDPOINT.
// ─────────────────────────────────────────────────────────────

export const KAKAO_QUEUE_NAME = 'kakao';

export const KakaoJobPayloadSchema = z.object({
  /** Optional Notification row id (R29 fan-out). */
  notificationId: z.string().optional(),
  /** Recipient phone number, same format rules as SmsJobPayload.to. */
  to: z.string().min(1),
  /**
   * Pre-approved KakaoTalk Bizmessage template code. Required even in
   * stub mode so the payload shape stays stable and the eventual real
   * provider call needs no schema change.
   */
  templateCode: z.string().min(1),
  /**
   * Template variables substituted server-side by the provider. We
   * pass through verbatim (string→string map); numeric/boolean values
   * should be stringified by the caller.
   */
  variables: z.record(z.string(), z.string()).default({}),
});

export type KakaoJobPayload = z.infer<typeof KakaoJobPayloadSchema>;

export const KakaoResultSchema = z.object({
  notificationId: z.string().optional(),
  to: z.string(),
  status: z.enum(['SENT', 'SKIPPED', 'FAILED']),
  /** Provider-side message id when available. */
  providerId: z.string().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().optional(),
});

export type KakaoResult = z.infer<typeof KakaoResultSchema>;

// ─────────────────────────────────────────────────────────────
// R40 S-1 — PDF body text extraction queue.
//
// Separate BullMQ queue (`pdf-extract`) consumed by
// `apps/worker/src/pdf-extract-worker.ts`. The main `dwg-conversion`
// worker (apps/worker/src/index.ts) enqueues here when a ConversionJob
// reaches DONE and a PDF artifact (`<attachmentId>/preview.pdf`) is
// available in storage.
//
// The worker:
//   1) Pulls the PDF bytes via storage.get(pdfStorageKey).
//   2) Runs `pdfjs-dist/legacy/build/pdf.mjs` to extract text content
//      page-by-page (`getTextContent().items[].str`, joined with `\n\n`
//      between pages).
//   3) Writes the extracted plain text to `Attachment.contentText`. The
//      Postgres GENERATED column `content_tsv` (migration 0014) picks up
//      the new value automatically — no separate write needed.
//
// The /api/v1/objects search route (R40 §2.5) issues a raw
// `to_tsquery('simple', $1) @@ "Attachment"."content_tsv"` query +
// `ts_headline(...)` snippet, OR-unioning with the existing pg_trgm
// hits over number/name/description.
//
// Failure policy: BullMQ 3 attempts + exponential backoff. On final
// failure `contentText` stays NULL — the search query simply won't
// match those rows. Admin retry is a R41 follow-up.
//
// `PDF_EXTRACT_ENABLED=0` short-circuits both the worker bootstrap and
// the enqueue gate so dev/CI never spin up the pdfjs runtime.
//
// License posture: pdfjs-dist is Apache 2.0. No GPL/AGPL transitive
// deps in the npm tree.
// ─────────────────────────────────────────────────────────────

export const PDF_EXTRACT_QUEUE_NAME = 'pdf-extract';

export const PdfExtractJobPayloadSchema = z.object({
  /** Attachment row id whose `contentText` will be populated on success. */
  attachmentId: z.string(),
  /**
   * Storage key for the PDF whose body text should be extracted. Typically
   * `<attachmentId>/preview.pdf` (master conversion artifact) but the
   * worker treats the value verbatim — any storage key resolving to a PDF
   * is fair game (e.g. `<attachmentId>/source.pdf` for direct PDF uploads
   * once a future round wires that path).
   */
  pdfStorageKey: z.string(),
});

export type PdfExtractJobPayload = z.infer<typeof PdfExtractJobPayloadSchema>;

export const PdfExtractResultSchema = z.object({
  attachmentId: z.string(),
  status: z.enum(['DONE', 'SKIPPED', 'FAILED']),
  /** Number of characters written to Attachment.contentText (pre-trim). */
  charCount: z.number().int().nonnegative().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().optional(),
});

export type PdfExtractResult = z.infer<typeof PdfExtractResultSchema>;

// ─────────────────────────────────────────────────────────────
// R-AUDIT-TREND — Security audit snapshot queue (FIND-016 mitigated).
//
// Persists `pnpm audit --json` results to a SecurityAuditSnapshot row on
// a daily schedule so the admin security page can plot trend over time.
// The legacy `audit/route.ts` keeps a 15-min in-memory cache for the
// "current state" card; this queue is the long-running baseline so an
// instance restart doesn't lose history.
//
// Two job sources:
//   - 'cron'   : daily repeatable enrolled by the worker when
//                SECURITY_AUDIT_CRON_ENABLED=1 (default 02:30 UTC,
//                separated from the backup cron's 02:00 to avoid IO
//                competition on a single-host box).
//   - 'manual' : SUPER_ADMIN-triggered via
//                POST /api/v1/admin/security/audit/snapshot. Writes a
//                row tagged source='manual' so the trend chart can
//                filter it out as noise.
//
// License posture: the worker's `pnpm audit` runs as a child_process —
// no JS bindings, no GPL transitive imports.
// ─────────────────────────────────────────────────────────────

export const SECURITY_AUDIT_QUEUE_NAME = 'security-audit';

export const SecurityAuditJobPayloadSchema = z.object({
  /**
   * Origin of the snapshot. 'cron' = automatic daily repeatable, 'manual'
   * = admin-triggered ad-hoc run. Stored on the row's `source` column so
   * trend queries can filter by either.
   */
  source: z.enum(['cron', 'manual']).default('cron'),
});
export type SecurityAuditJobPayload = z.infer<
  typeof SecurityAuditJobPayloadSchema
>;

export const SecurityAuditResultSchema = z.object({
  /** Snapshot row id (cuid) — the worker returns this so callers can lookup. */
  snapshotId: z.string(),
  /** Sum of critical+high+moderate+low. Persisted on the row's `total` col. */
  total: z.number().int().nonnegative(),
  /** Subprocess wallclock — useful for spotting registry slowdown trends. */
  durationMs: z.number().int().nonnegative(),
});
export type SecurityAuditResult = z.infer<typeof SecurityAuditResultSchema>;
