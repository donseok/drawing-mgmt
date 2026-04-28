// R49 / FIND-012 — MIME-type allow-list shared by the two upload entry
// points so the validation matrix stays in lock-step.
//
//  - POST /api/v1/uploads             (chunked-upload init, JSON body)
//  - POST /api/v1/objects/:id/attachments  (multipart, file.type)
//
// Why an allow-list:
//   The previous behavior accepted any client-supplied `Content-Type` /
//   `mimeType`, which let an attacker (or a misbehaving client) claim, e.g.,
//   `text/html` and trick a downstream renderer into treating an attachment
//   as an inline document. The list below covers the formats the system
//   actually serves (DWG/DXF, PDF, raster previews) plus a generic
//   `application/octet-stream` fallback because some browsers send DWG/DXF
//   uploads with that claim. Real content safety is still enforced by the
//   ClamAV virus scan (R36) — this allow-list is a fast, syntactic gate
//   that turns away the cheapest abuse cases at the API boundary.

/**
 * MIME types accepted by the upload routes.
 *
 * Order/grouping below is documentation only; runtime treats this as a set.
 *  - CAD source / drawings: AutoCAD DWG (multiple historical claim spellings)
 *    and DXF (text + binary variants).
 *  - Documents: PDF.
 *  - Images: PNG / JPEG / TIFF cover scanned-attachment + thumbnail use.
 *  - Generic fallback: `application/octet-stream` is allowed because
 *    Chromium-based browsers commonly attach DWG with that claim. ClamAV
 *    sees the actual bytes downstream.
 */
export const ALLOWED_MIME_TYPES = [
  // CAD
  'application/acad',
  'image/vnd.dwg',
  'image/x-dwg',
  'application/x-dwg',
  'application/dxf',
  'application/x-dxf',
  'image/vnd.dxf',
  // Documents
  'application/pdf',
  // Images (썸네일/스캔 첨부)
  'image/png',
  'image/jpeg',
  'image/tiff',
  // Generic fallback (claim이 부정확할 수 있어 fallback 1개)
  'application/octet-stream',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const ALLOWED_SET: ReadonlySet<string> = new Set<string>(ALLOWED_MIME_TYPES);

/**
 * Lower-cases + strips a possible `; charset=...` parameter before checking
 * membership. Returns true when the given mime is on the allow-list.
 *
 * Multipart `File.type` is usually a clean token (e.g. `application/pdf`)
 * but multipart forms occasionally pass a parameterized form (e.g.
 * `application/pdf; charset=binary`); normalizing here keeps callers from
 * having to repeat the parsing.
 */
export function isAllowedMimeType(value: string | null | undefined): boolean {
  if (!value) return false;
  const head = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return ALLOWED_SET.has(head);
}
