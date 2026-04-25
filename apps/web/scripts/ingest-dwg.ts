/**
 * Dev ingest script — no DB / no queue.
 *
 * Takes a local DWG file, converts it to DXF via the worker CLI (which wraps
 * ODA File Converter), and stages the result under
 * FILE_STORAGE_ROOT/<id>/preview.dxf so the viewer can open it directly.
 *
 * Usage:
 *   pnpm --filter @drawing-mgmt/web ingest <path-to.dwg> [--id <id>]
 *
 * Output: prints the viewer URL. Open it in the browser.
 *
 * Implementation note: invokes the worker via `pnpm --filter ... convert` as
 * a subprocess so we don't pull worker's runtime deps (execa, etc.) into the
 * web app's module graph.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error('Usage: ingest <path-to.dwg> [--id <id>]');
    process.exit(2);
  }
  const inputArg = argv[0];
  const idIdx = argv.indexOf('--id');
  const id = idIdx >= 0 ? argv[idIdx + 1] : randomUUID();

  const input = path.resolve(inputArg);
  const stat = await fs.stat(input);
  if (!stat.isFile()) {
    console.error(`not a file: ${input}`);
    process.exit(2);
  }

  // FILE_STORAGE_ROOT may be relative — anchor it to the repo root regardless
  // of where this script runs from. We assume this file lives at
  // <repo>/apps/web/scripts/ingest-dwg.ts.
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const storageRoot = path.isAbsolute(process.env.FILE_STORAGE_ROOT ?? '')
    ? path.resolve(process.env.FILE_STORAGE_ROOT!)
    : path.resolve(repoRoot, process.env.FILE_STORAGE_ROOT ?? './apps/web/.data/files');

  const targetDir = path.join(storageRoot, id);
  await fs.mkdir(targetDir, { recursive: true });

  console.log(`[ingest] id=${id}`);
  console.log(`[ingest] input=${input}`);
  console.log(`[ingest] storage=${targetDir}`);

  // Stash the original under source.dwg (acts as `Attachment.storagePath`).
  await fs.copyFile(input, path.join(targetDir, 'source.dwg'));

  // Convert DWG → DXF via worker CLI into a scratch dir, then move the result.
  const scratch = path.join(os.tmpdir(), `dm-ingest-${randomUUID()}`);
  await fs.mkdir(scratch, { recursive: true });

  const startedAt = Date.now();
  await runWorkerConvert(input, scratch);
  const dxfBase = path.basename(input).replace(/\.[^.]+$/, '.dxf');
  const dxfFromScratch = path.join(scratch, dxfBase);
  await fs.copyFile(dxfFromScratch, path.join(targetDir, 'preview.dxf'));
  await fs.rm(scratch, { recursive: true, force: true });

  const sidecar = {
    filename: path.basename(input),
    mimeType: 'application/acad',
    size: stat.size,
    objectId: `dev-${id}`,
    objectNumber: 'CGL-DEV-2026-00001',
    objectName: `${path.basename(input, path.extname(input))} (ingested)`,
  };
  await fs.writeFile(
    path.join(targetDir, 'meta.json'),
    JSON.stringify(sidecar, null, 2),
    'utf8',
  );

  const dur = Date.now() - startedAt;
  const url = `http://localhost:3000/viewer/${id}`;
  console.log(`[ingest] done in ${dur}ms`);
  console.log(`[ingest] open → ${url}`);
}

function runWorkerConvert(input: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'pnpm.cmd' : 'pnpm';
    const args = ['--filter', '@drawing-mgmt/worker', 'convert', input, outDir];
    // shell: true required on Node ≥ 18.20 / 20.12 / 22 to spawn .cmd files
    // on Windows (CVE-2024-27980 mitigation).
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker convert exited with code ${code}`));
    });
  });
}

main().catch((err) => {
  console.error('[ingest] FAILED:', err);
  process.exit(1);
});
