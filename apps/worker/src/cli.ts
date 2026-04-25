/**
 * Local CLI for ODA conversion (no queue, no DB).
 *
 * Usage:
 *   pnpm --filter @drawing-mgmt/worker convert <input.dwg> [outDir]
 *
 * Default outDir: alongside the input.
 *
 * Useful as a smoke test that the ODA install and adapter work end-to-end
 * before bringing up Redis/Postgres.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dwgToDxf, dxfToDwg } from './oda.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: convert <input.dwg|input.dxf> [outDir]');
    process.exit(2);
  }
  const input = path.resolve(args[0]);
  const outDir = path.resolve(args[1] ?? path.dirname(input));
  await fs.mkdir(outDir, { recursive: true });

  const inExt = path.extname(input).toLowerCase();
  const outExt = inExt === '.dwg' ? '.dxf' : '.dwg';

  const oda =
    process.env.ODA_CONVERTER_PATH ??
    'C:/Program Files/ODA/ODAFileConverter 27.1.0/ODAFileConverter.exe';

  const startedAt = Date.now();
  console.log(`[convert] input=${input} (${inExt} → ${outExt})`);
  console.log(`[convert] oda=${oda}`);

  const { dxfPath, cleanup } =
    inExt === '.dwg'
      ? await dwgToDxf(input, { converterPath: oda })
      : await dxfToDwg(input, { converterPath: oda });
  const baseOut = path.basename(input).replace(/\.[^.]+$/, outExt);
  const target = path.join(outDir, baseOut);
  await fs.copyFile(dxfPath, target);
  await cleanup();

  const durMs = Date.now() - startedAt;
  console.log(`[convert] done → ${target} (${durMs}ms)`);
}

main().catch((err) => {
  console.error('[convert] FAILED:', err);
  process.exit(1);
});
