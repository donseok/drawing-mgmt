/**
 * POST /api/v1/dev/ingest-dwg
 *
 * Dev-only endpoint. Accepts a multipart upload of a single DWG/DXF file,
 * stages it under FILE_STORAGE_ROOT/<id>/source.dwg, runs the worker CLI to
 * produce preview.dxf, writes meta.json, and returns the new id so the
 * client can navigate to /viewer/<id>.
 *
 * NOT for production use:
 *  - No DB persistence (no Attachment row, no Object lifecycle).
 *  - No queue (synchronous spawn of worker convert subprocess).
 *  - Auth optional so devs can demo without seeded users.
 *
 * The eventual prod endpoint will land at /api/v1/objects/[id]/attachments
 * with chunked upload + Prisma + BullMQ.
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { auth } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cap at 100 MB — DWGs rarely exceed this and we want to bail out fast on
// accidental huge uploads. Adjust via env if needed.
const MAX_BYTES = Number(process.env.DEV_INGEST_MAX_BYTES ?? 100 * 1024 * 1024);

const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const STORAGE_ROOT = path.isAbsolute(process.env.FILE_STORAGE_ROOT ?? '')
  ? path.resolve(process.env.FILE_STORAGE_ROOT!)
  : path.resolve(
      process.cwd(),
      process.env.FILE_STORAGE_ROOT ?? './.data/files',
    );

export async function POST(req: Request): Promise<Response> {
  await auth().catch(() => null);

  const ct = req.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().includes('multipart/form-data')) {
    return NextResponse.json(
      { error: 'expected multipart/form-data' },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid form data', detail: (err as Error).message },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'missing "file" field' },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_BYTES} bytes)` },
      { status: 413 },
    );
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!['.dwg', '.dxf'].includes(ext)) {
    return NextResponse.json(
      { error: `unsupported extension: ${ext} (expected .dwg or .dxf)` },
      { status: 400 },
    );
  }

  const id = randomUUID();
  const targetDir = path.join(STORAGE_ROOT, id);
  await fs.mkdir(targetDir, { recursive: true });

  const sourceName = ext === '.dwg' ? 'source.dwg' : 'source.dxf';
  const sourcePath = path.join(targetDir, sourceName);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(sourcePath, buf);

  const startedAt = Date.now();
  let conversionError: string | null = null;
  try {
    if (ext === '.dwg') {
      // DWG → DXF via worker CLI
      const scratch = path.join(os.tmpdir(), `dm-ingest-${id}`);
      await fs.mkdir(scratch, { recursive: true });
      try {
        await runWorkerConvert(sourcePath, scratch);
        const dxfBase = path.basename(sourcePath).replace(/\.[^.]+$/, '.dxf');
        await fs.copyFile(
          path.join(scratch, dxfBase),
          path.join(targetDir, 'preview.dxf'),
        );
      } finally {
        await fs.rm(scratch, { recursive: true, force: true });
      }
    } else {
      // DXF input — copy as preview.dxf directly. ODA roundtrip is unnecessary.
      await fs.copyFile(sourcePath, path.join(targetDir, 'preview.dxf'));
    }
  } catch (err) {
    conversionError = (err as Error).message;
  }

  const sidecar = {
    filename: file.name,
    mimeType: file.type || 'application/acad',
    size: file.size,
    objectId: `dev-${id}`,
    objectNumber: 'CGL-DEV-2026-00001',
    objectName: `${path.basename(file.name, ext)} (uploaded)`,
  };
  await fs.writeFile(
    path.join(targetDir, 'meta.json'),
    JSON.stringify(sidecar, null, 2),
    'utf8',
  );

  const durationMs = Date.now() - startedAt;
  if (conversionError) {
    return NextResponse.json(
      {
        id,
        viewerUrl: `/viewer/${id}`,
        conversion: 'failed',
        error: conversionError,
        durationMs,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id,
    viewerUrl: `/viewer/${id}`,
    conversion: 'success',
    durationMs,
  });
}

function runWorkerConvert(input: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'pnpm.cmd' : 'pnpm';
    const args = ['--filter', '@drawing-mgmt/worker', 'convert', input, outDir];
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      shell: true,
    });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker convert exited ${code}\n${stderr}`));
    });
  });
}
