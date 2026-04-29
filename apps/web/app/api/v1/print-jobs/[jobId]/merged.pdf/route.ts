// GET /api/v1/print-jobs/{jobId}/merged.pdf
//
// R-PDF-MERGE — stream the merged PDF artifact for a PDF_MERGE
// ConversionJob. Only DONE rows whose `metadata.kind === 'PDF_MERGE'` are
// served. Permission: `metadata.requestedBy === user.id` OR the user is an
// admin / super_admin (admins bypass for operational support — same posture
// as the backups download endpoint).
//
// Why a separate endpoint (instead of reusing `/api/v1/attachments/{id}/preview.pdf`):
//   - The merged PDF doesn't belong to a single attachment; it's an
//     aggregate keyed by ConversionJob row id (`<jobId>/merged.pdf` in
//     storage).
//   - The Content-Disposition filename includes today's date so users get
//     `drawings-YYYY-MM-DD.pdf` instead of an opaque attachment id.
//   - Per-row permission was already validated at enqueue time; re-checking
//     here would force a needless folder-permission lookup loop.

import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PdfMergeJobMetadata {
  kind?: 'PRINT' | 'PDF_MERGE';
  requestedBy?: string;
  totalCount?: number;
  successCount?: number;
  failureCount?: number;
}

async function handleGet(
  req: Request,
  { params }: { params: { jobId: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const job = await prisma.conversionJob.findUnique({
    where: { id: params.jobId },
    select: {
      id: true,
      status: true,
      pdfPath: true,
      metadata: true,
    },
  });
  if (!job) return error(ErrorCode.E_NOT_FOUND);

  const meta = (job.metadata ?? null) as PdfMergeJobMetadata | null;
  if (meta?.kind !== 'PDF_MERGE') {
    // Don't expose PRINT or other kinds through this endpoint — 404 to keep
    // the surface narrow.
    return error(ErrorCode.E_NOT_FOUND);
  }

  // Owner-or-admin gate.
  const isOwner = meta.requestedBy === user.id;
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  if (!isOwner && !isAdmin) {
    return error(ErrorCode.E_FORBIDDEN);
  }

  if (job.status !== 'DONE') {
    // Use 404 (not 409) so a polling FE that races with the worker doesn't
    // surface a state-conflict toast — the user just sees "preparing…" until
    // the next poll.
    return error(
      ErrorCode.E_NOT_FOUND,
      '병합 PDF가 아직 준비되지 않았습니다.',
    );
  }
  if (!job.pdfPath) {
    return error(
      ErrorCode.E_NOT_FOUND,
      '병합 PDF 경로가 비어 있습니다 (전체 실패였을 수 있습니다).',
    );
  }

  // Pull bytes from storage. We read into a Buffer rather than streaming
  // because the merged PDF size is bounded (≤50 attachments) and Buffer
  // simplifies Content-Length on the response. Streaming is a follow-up if
  // very large bulk merges hit memory pressure.
  const storage = getStorage();
  let stream: NodeJS.ReadableStream;
  let size: number;
  try {
    const got = await storage.get(job.pdfPath);
    stream = got.stream;
    size = got.size;
  } catch {
    return error(
      ErrorCode.E_NOT_FOUND,
      '병합 PDF 파일이 스토리지에서 사라졌습니다.',
    );
  }

  // Audit log — admin oversight + GDPR-style data access trail. The job id
  // and pdfPath go into metadata so a forensic query can correlate the
  // download with the bulk request.
  const reqMeta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'OBJECT_PRINT',
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: {
      jobId: job.id,
      kind: 'PDF_MERGE_DOWNLOAD',
      pdfPath: job.pdfPath,
      totalCount: meta.totalCount ?? null,
      successCount: meta.successCount ?? null,
      failureCount: meta.failureCount ?? null,
    },
  });

  // Build a Web ReadableStream from the storage Node stream so NextResponse
  // can pipe it through Edge-style infrastructure if needed (locally it's a
  // straight passthrough).
  const webStream = Readable.toWeb(
    Readable.from(stream as Readable),
  ) as NodeReadableStream<Uint8Array>;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `drawings-${today}.pdf`;
  // RFC 5987 — filename* uses UTF-8 percent-encoding for safety with non-ASCII.
  const filenameStar = `UTF-8''${encodeURIComponent(filename)}`;

  return new NextResponse(webStream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${filename}"; filename*=${filenameStar}`,
      'Cache-Control': 'private, no-store',
    },
  });
}

// `withApi` wraps GET too — CSRF assertion is short-circuited by
// `isMutating`, but rate-limit is engaged via the same scope so a runaway
// download loop still hits the bucket.
export const GET = withApi<{ params: { jobId: string } }>(
  { rateLimit: 'api' },
  handleGet,
);
