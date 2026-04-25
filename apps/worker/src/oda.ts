/**
 * ODA File Converter adapter.
 *
 * Converts DWG ↔ DXF using ODA File Converter CLI.
 * The CLI works on directories (not individual files), so we stage the input
 * in a unique temp dir, invoke the converter, and then move the result out.
 *
 * CLI signature (positional):
 *   ODAFileConverter <InDir> <OutDir> <OutVer> <OutFmt> <Recurse> <Audit> [Filter]
 *     OutVer:  ACAD2018 | ACAD2013 | ... | ACAD9
 *     OutFmt:  DWG | DXF | DXB
 *     Recurse: 0 | 1
 *     Audit:   0 | 1
 *     Filter:  *.DWG (default)
 *
 * Note: ODA does NOT generate PDF — that's a separate pipeline (TBD).
 */

import { execa } from 'execa';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export interface OdaOptions {
  /** Path to ODAFileConverter executable. */
  converterPath: string;
  /** Target AutoCAD version label (default ACAD2018). */
  outputVersion?: string;
  /** Run audit pass (0|1) — default 1 (auto-fix minor issues). */
  audit?: 0 | 1;
  /** Timeout in ms (default 120s). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Convert a DWG file at `inputPath` to DXF, returning the absolute path
 * of the produced DXF file. Caller is responsible for moving it to its
 * final location.
 *
 * Uses a one-shot temp dir under os.tmpdir() that is cleaned up on success.
 * On failure the temp dir is preserved (returned in the thrown error) for
 * post-mortem.
 */
export async function dwgToDxf(
  inputPath: string,
  opts: OdaOptions,
): Promise<{ dxfPath: string; cleanup: () => Promise<void> }> {
  return convertDir(inputPath, 'DXF', opts);
}

/** DXF → DWG (same shape as dwgToDxf). */
export async function dxfToDwg(
  inputPath: string,
  opts: OdaOptions,
): Promise<{ dxfPath: string; cleanup: () => Promise<void> }> {
  return convertDir(inputPath, 'DWG', opts);
}

async function convertDir(
  inputPath: string,
  outFmt: 'DWG' | 'DXF' | 'DXB',
  opts: OdaOptions,
): Promise<{ dxfPath: string; cleanup: () => Promise<void> }> {
  const inExt = path.extname(inputPath).toUpperCase().replace('.', '');
  if (!['DWG', 'DXF'].includes(inExt)) {
    throw new Error(`unsupported input extension: ${inExt}`);
  }

  // Unique staging dir so concurrent jobs don't collide.
  const stage = path.join(os.tmpdir(), `dm-oda-${randomUUID()}`);
  const inDir = path.join(stage, 'in');
  const outDir = path.join(stage, 'out');
  await fs.mkdir(inDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  // Copy input under its real basename so ODA writes the corresponding output.
  const baseName = path.basename(inputPath);
  const stagedInput = path.join(inDir, baseName);
  await fs.copyFile(inputPath, stagedInput);

  const args = [
    inDir,
    outDir,
    opts.outputVersion ?? 'ACAD2018',
    outFmt,
    '0', // recurse
    String(opts.audit ?? 1),
    `*.${inExt}`,
  ];

  try {
    await execa(opts.converterPath, args, {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      // ODA prints chatty stdout; we tolerate non-zero exit if the file appeared.
      reject: false,
    });
  } catch (err) {
    await safeRm(stage);
    throw err;
  }

  // Output filename = input basename with new extension.
  const outBase = baseName.replace(/\.[^.]+$/, `.${outFmt.toLowerCase()}`);
  const outPath = path.join(outDir, outBase);

  try {
    await fs.access(outPath);
  } catch {
    // ODA didn't produce an output — leave stage for inspection.
    throw new Error(
      `ODA produced no output at ${outPath} (input=${inputPath}, stage=${stage})`,
    );
  }

  return {
    dxfPath: outPath,
    cleanup: () => safeRm(stage),
  };
}

async function safeRm(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
