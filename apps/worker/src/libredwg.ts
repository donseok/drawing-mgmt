/**
 * LibreDWG adapter.
 *
 * GPL-licensed binary, called as a subprocess only — no JS bindings imported.
 * That keeps the rest of the codebase MIT/Apache. Do NOT add @mlightcad/*,
 * libredwg-js, dwg-js, or any JS port to package.json.
 *
 * The CLI we shell out to is `dwg2dxf`, which converts a single DWG file to
 * a single DXF file:
 *
 *   dwg2dxf [-y] [-v3] [-o OUTFILE] INFILE
 *
 *   -o OUTFILE    explicit output path (we always supply this so we know
 *                 exactly where the result lands)
 *   -y            overwrite existing OUTFILE without prompting
 *   -v0..-v9      verbosity (we run silent by default)
 *
 * Default lookup: PATH (`dwg2dxf`). Override with the LIBREDWG_DWG2DXF_PATH
 * env var or the `binPath` option. If the binary is missing we throw a
 * sentinel error so the caller can fall through (e.g. log + skip).
 */

import { execa } from 'execa';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export class LibreDwgUnavailableError extends Error {
  readonly code = 'LIBREDWG_NOT_AVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'LibreDwgUnavailableError';
  }
}

export interface LibreDwgOptions {
  /** Override path to the dwg2dxf binary (default: env LIBREDWG_DWG2DXF_PATH or 'dwg2dxf'). */
  binPath?: string;
  /** Hard timeout in ms for the subprocess (default 120s). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Convert a DWG file at `inputPath` to DXF using LibreDWG `dwg2dxf`.
 * Same shape as `oda.dwgToDxf`: returns the absolute path of the produced
 * DXF + a cleanup function. Caller copies the file to its final destination.
 *
 * Throws `LibreDwgUnavailableError` when the binary cannot be found, so the
 * worker can log + continue (CI/dev without the binary should not crash).
 * Other errors (conversion failed, no output) propagate as-is for retry.
 */
export async function dwgToDxfLibre(
  inputPath: string,
  opts: LibreDwgOptions = {},
): Promise<{ dxfPath: string; cleanup: () => Promise<void> }> {
  const inExt = path.extname(inputPath).toLowerCase();
  if (inExt !== '.dwg') {
    throw new Error(`unsupported input extension for LibreDWG: ${inExt}`);
  }

  const binPath =
    opts.binPath ?? process.env.LIBREDWG_DWG2DXF_PATH ?? 'dwg2dxf';

  // Stage in a unique temp dir so concurrent jobs don't collide on the
  // output filename and so cleanup is one rm.
  const stage = path.join(os.tmpdir(), `dm-libredwg-${randomUUID()}`);
  await fs.mkdir(stage, { recursive: true });

  const baseName = path.basename(inputPath, inExt);
  const outPath = path.join(stage, `${baseName}.dxf`);

  try {
    const { exitCode, stderr } = await execa(
      binPath,
      ['-y', '-o', outPath, inputPath],
      {
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        // dwg2dxf prints progress to stderr even on success; tolerate non-zero
        // exit so we can decide based on whether the file appeared.
        reject: false,
      },
    );

    try {
      await fs.access(outPath);
    } catch {
      // Differentiate "binary missing" (ENOENT) from "binary ran but produced
      // no output". execa surfaces ENOENT as exit code typically with stderr.
      const stderrText = (stderr ?? '').toString();
      if (
        stderrText.includes('ENOENT') ||
        stderrText.includes('not found') ||
        stderrText.includes('command not found')
      ) {
        await safeRm(stage);
        throw new LibreDwgUnavailableError(
          `dwg2dxf binary not found at "${binPath}" — set LIBREDWG_DWG2DXF_PATH`,
        );
      }
      await safeRm(stage);
      throw new Error(
        `LibreDWG produced no output (exit=${exitCode}, stderr=${stderrText.slice(0, 400)})`,
      );
    }
  } catch (err) {
    // execa throws synchronous-ish for ENOENT before exit code is available.
    const errCode =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (errCode === 'ENOENT') {
      await safeRm(stage);
      throw new LibreDwgUnavailableError(
        `dwg2dxf binary not found at "${binPath}" — set LIBREDWG_DWG2DXF_PATH`,
      );
    }
    if (err instanceof LibreDwgUnavailableError) {
      throw err;
    }
    await safeRm(stage);
    throw err;
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
