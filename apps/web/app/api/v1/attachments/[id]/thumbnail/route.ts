/**
 * GET /api/v1/attachments/[id]/thumbnail
 *
 * 256×256 PNG thumbnail. Stub returns a generated placeholder SVG so search
 * grids/cards have something to render in dev.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export async function GET(
  _req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  // DEV/DEMO: auth optional so viewer/grid can demo without DB. TODO: production gate.
  await auth().catch(() => null);
  const { id } = ctx.params;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" fill="#f3f4f6"/>
  <rect x="0.5" y="0.5" width="255" height="255" fill="none" stroke="#d1d5db"/>
  <g fill="#6b7280" font-family="system-ui, sans-serif" text-anchor="middle">
    <text x="128" y="120" font-size="14">미리보기 없음</text>
    <text x="128" y="142" font-size="11" font-family="ui-monospace, monospace">${id.slice(0, 16)}</text>
  </g>
</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'private, max-age=60',
    },
  });
}
