/**
 * Client-side fetch helpers for viewer-related endpoints.
 *
 * All routes here are stubs in dev (the conversion pipeline isn't running).
 * When the API returns 404 we fall back to {@link sample-fixtures} so the
 * viewer is testable end-to-end without DB seed.
 */

import type { AttachmentMeta } from './types';

export type PreviewKind = 'pdf' | 'dxf' | 'thumbnail' | 'file';

const KIND_PATH: Record<PreviewKind, string> = {
  pdf: 'preview.pdf',
  dxf: 'preview.dxf',
  thumbnail: 'thumbnail',
  file: 'file',
};

/**
 * Build the API URL for a given attachment preview / asset.
 *
 * Returns the URL path; does NOT fetch. The viewer engines (PDF.js / dxf-viewer)
 * accept a URL and stream the bytes themselves with credentials.
 */
export function previewUrl(attachmentId: string, kind: PreviewKind): string {
  return `/api/v1/attachments/${encodeURIComponent(attachmentId)}/${KIND_PATH[kind]}`;
}

/**
 * HEAD the preview URL — returns true if the server says the asset exists
 * (200), false if 404. Any other status throws.
 */
export async function previewExists(
  attachmentId: string,
  kind: PreviewKind,
): Promise<boolean> {
  const res = await fetch(previewUrl(attachmentId, kind), { method: 'HEAD' });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(
    `Unexpected status ${res.status} for ${kind} preview ${attachmentId}`,
  );
}

/**
 * Fetch attachment metadata. Falls back to a dummy stub if the server returns
 * 404 (so the viewer can still render the title bar in dev).
 */
export async function fetchAttachmentMeta(
  attachmentId: string,
): Promise<AttachmentMeta> {
  const res = await fetch(
    `/api/v1/attachments/${encodeURIComponent(attachmentId)}/meta`,
    { cache: 'no-store' },
  );
  if (res.ok) {
    return (await res.json()) as AttachmentMeta;
  }
  if (res.status === 404) {
    return makeFallbackMeta(attachmentId);
  }
  throw new Error(`Failed to load attachment meta (${res.status})`);
}

/** Synthetic metadata for when the API has nothing for this id (dev mode). */
export function makeFallbackMeta(attachmentId: string): AttachmentMeta {
  return {
    id: attachmentId,
    filename: 'sample-drawing.dwg',
    mimeType: 'application/acad',
    size: 0,
    isMaster: true,
    conversionStatus: 'success',
    hasPdf: true,
    hasDxf: true,
    hasThumbnail: true,
    objectId: 'dev-object',
    objectNumber: 'CGL-DEV-2026-00001',
    objectName: '샘플 도면 (개발 모드)',
  };
}
