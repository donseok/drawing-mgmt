/**
 * GET /api/v1/attachments/[id]/file
 *
 * Original (uploaded) file download. In dev this is a stub that returns 404
 * so the viewer can fall back to its sample fixtures. The real implementation
 * will stream from object storage with a checksum check (TRD §4).
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
