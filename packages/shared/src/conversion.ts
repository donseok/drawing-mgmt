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
