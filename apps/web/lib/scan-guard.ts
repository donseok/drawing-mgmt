// R36 / V-INF-3 — Virus scan guard for attachment-serving routes.
//
// Centralizes the "is this attachment INFECTED?" check used by:
//   - GET /api/v1/attachments/{id}/file
//   - GET /api/v1/attachments/{id}/preview.dxf
//   - GET /api/v1/attachments/{id}/preview.pdf
//   - GET /api/v1/attachments/{id}/thumbnail
//   - POST /api/v1/attachments/{id}/print
//
// Policy:
//   - INFECTED → block with 403 + a Korean message. The download/preview
//     button on the FE is also disabled, but we enforce server-side in case
//     someone hits the URL directly.
//   - All other states (PENDING, SCANNING, CLEAN, SKIPPED, FAILED) — allow.
//     The default behaviour matches "fail open" for the legacy ingest path
//     where rows might still be PENDING when an admin runs a backfill scan.
//
// Performance: a single targeted SELECT on `Attachment.virusScanStatus`. The
// caller usually does its own attachment lookup; we keep this guard separate
// so it can run before that heavier query when desired.

import { prisma } from '@/lib/prisma';
import { error, ErrorCode } from '@/lib/api-response';
import type { NextResponse } from 'next/server';

/**
 * Look up the scan status for a given attachment id.
 * Returns null when the attachment doesn't exist (caller decides 404).
 */
export async function getScanStatus(
  attachmentId: string,
): Promise<{ virusScanStatus: string; virusScanSig: string | null } | null> {
  const row = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: { virusScanStatus: true, virusScanSig: true },
  });
  if (!row) return null;
  return row;
}

/**
 * Returns a NextResponse to short-circuit the route when the attachment is
 * INFECTED. Returns null when the attachment is missing or in any other
 * state. Intended usage:
 *
 *   const blocked = await blockIfInfected(id);
 *   if (blocked) return blocked;
 */
export async function blockIfInfected(
  attachmentId: string,
): Promise<NextResponse | null> {
  const status = await getScanStatus(attachmentId);
  if (!status) return null;
  if (status.virusScanStatus !== 'INFECTED') return null;
  return error(
    ErrorCode.E_FORBIDDEN,
    `바이러스 감염 — 다운로드 차단 (${status.virusScanSig ?? '시그니처 미상'})`,
  );
}

/**
 * Predicate variant. Useful when the caller already loaded the attachment
 * with a wider select and just wants to flip on the boolean.
 */
export function isInfected(virusScanStatus: string | null | undefined): boolean {
  return virusScanStatus === 'INFECTED';
}
