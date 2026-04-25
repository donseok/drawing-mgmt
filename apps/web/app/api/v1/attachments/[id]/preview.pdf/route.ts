/**
 * GET /api/v1/attachments/[id]/preview.pdf
 *
 * PDF preview — produced by the conversion worker (DWG → PDF via ODA File
 * Converter). Stub: 404 so the viewer falls back to SAMPLE_PDF.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export async function GET(
  _req: Request,
  _ctx: { params: { id: string } },
): Promise<Response> {
  // DEV/DEMO: auth optional so viewer can demo without DB. TODO: production gate.
  await auth().catch(() => null);
  return new NextResponse('Not Found', { status: 404 });
}
