/**
 * generate-seed-previews — drops sample preview.pdf / preview.dxf / thumbnail.png
 * under FILE_STORAGE_ROOT/<attachmentId>/ for every seeded Attachment so the
 * viewer + list grid have something real to render before the worker pipeline
 * (ODA / LibreDWG) is wired up.
 *
 * Idempotent: overwrites existing files. Safe to re-run.
 *
 * Usage:
 *   pnpm --filter @drawing-mgmt/web seed:previews
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import {
  getSamplePdfBytes,
  getSampleDxfBytes,
} from '../lib/viewer/sample-fixtures';

const prisma = new PrismaClient();

const STORAGE_ROOT = path.resolve(
  process.env.FILE_STORAGE_ROOT ?? './apps/web/.data/files',
);

async function thumbnailPng(label: string): Promise<Buffer> {
  // Render an SVG → PNG using sharp. SVG is small and easy to template.
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <defs>
    <pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="320" height="240" fill="#ffffff"/>
  <rect width="320" height="240" fill="url(#g)"/>
  <g transform="translate(160 110)" fill="none" stroke="#0f172a" stroke-width="1.5">
    <rect x="-90" y="-40" width="180" height="80" rx="2"/>
    <line x1="-90" y1="0" x2="90" y2="0" stroke-dasharray="4 3"/>
    <circle cx="-50" cy="-15" r="14"/>
    <circle cx="50" cy="-15" r="14"/>
    <path d="M -90 40 L -60 60 L 60 60 L 90 40"/>
  </g>
  <g transform="translate(160 200)" font-family="system-ui, sans-serif" text-anchor="middle">
    <text font-size="13" fill="#0f172a" font-weight="600">${escapeXml(label)}</text>
    <text y="16" font-size="10" fill="#64748b">샘플 미리보기 · 변환 파이프라인 미연결</text>
  </g>
</svg>`;
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function main() {
  console.log(`▶ Generating seed previews under ${STORAGE_ROOT}`);

  const attachments = await prisma.attachment.findMany({
    select: {
      id: true,
      filename: true,
      version: {
        select: {
          revision: { select: { object: { select: { number: true, name: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (attachments.length === 0) {
    console.warn('  ! No Attachment rows. Run `pnpm db:seed` first.');
    return;
  }

  const pdfBytes = getSamplePdfBytes();
  const dxfBytes = getSampleDxfBytes();

  for (const a of attachments) {
    const dir = path.join(STORAGE_ROOT, a.id);
    await fs.mkdir(dir, { recursive: true });

    const obj = a.version.revision.object;
    const label = `${obj.number}  ${obj.name}`;

    await Promise.all([
      fs.writeFile(path.join(dir, 'preview.pdf'), pdfBytes),
      fs.writeFile(path.join(dir, 'preview.dxf'), dxfBytes),
      thumbnailPng(label).then((png) => fs.writeFile(path.join(dir, 'thumbnail.png'), png)),
      fs.writeFile(
        path.join(dir, 'meta.json'),
        JSON.stringify(
          {
            filename: a.filename,
            mimeType: 'application/acad',
            objectId: obj.number,
            objectNumber: obj.number,
            objectName: obj.name,
          },
          null,
          2,
        ),
        'utf8',
      ),
    ]);

    console.log(`  ✓ ${a.id}  ${obj.number}  ${obj.name}`);
  }

  console.log(`✔ Done — ${attachments.length} attachments staged.`);
}

main()
  .catch((err) => {
    console.error('✖ generate-seed-previews failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
