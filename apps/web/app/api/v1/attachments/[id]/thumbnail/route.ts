/**
 * GET /api/v1/attachments/[id]/thumbnail
 *
 * Serves the conversion-pipeline-produced thumbnail.png for an attachment.
 * Falls back to a generated SVG placeholder when no file exists yet — keeps
 * the search grid usable without a running worker.
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { auth } from '@/auth';

const STORAGE_ROOT = path.resolve(process.env.FILE_STORAGE_ROOT ?? './.data/files');

function placeholderSvg(id: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" fill="#f3f4f6"/>
  <rect x="0.5" y="0.5" width="255" height="255" fill="none" stroke="#d1d5db"/>
  <g fill="#6b7280" font-family="system-ui, sans-serif" text-anchor="middle">
    <text x="128" y="120" font-size="14">미리보기 없음</text>
    <text x="128" y="142" font-size="11" font-family="ui-monospace, monospace">${id.slice(0, 16)}</text>
  </g>
</svg>`;
}

export async function GET(
  _req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  await auth().catch(() => null);
  const { id } = ctx.params;
  const filePath = resolveThumbnailPath(id);

  if (filePath) {
    try {
      const buf = await fs.readFile(filePath);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'private, max-age=300',
          'Content-Length': String(buf.length),
        },
      });
    } catch {
      /* fall through to placeholder */
    }
  }

  return new NextResponse(placeholderSvg(id), {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'private, max-age=60',
    },
  });
}

export async function HEAD(
  _req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  await auth().catch(() => null);
  const filePath = resolveThumbnailPath(ctx.params.id);
  if (!filePath) return new NextResponse(null, { status: 200 });
  try {
    const stat = await fs.stat(filePath);
    return new NextResponse(null, {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Content-Length': String(stat.size) },
    });
  } catch {
    return new NextResponse(null, { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
  }
}

function resolveThumbnailPath(id: string): string | null {
  if (!/^[A-Za-z0-9_\-]+$/.test(id)) return null;
  return path.join(STORAGE_ROOT, id, 'thumbnail.png');
}
