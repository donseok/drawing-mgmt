/**
 * R36 V-INF-3 — ClamAV adapter.
 *
 * GPL-2.0 antivirus engine, called as a subprocess only — no JS bindings
 * imported. That keeps the rest of the codebase MIT/Apache (same posture
 * as LibreDWG in `./libredwg.ts`). Do NOT add `clamscan`, `node-clamav`,
 * `node-clam`, or any wrapper that links the engine in-process.
 *
 * Two paths supported:
 *
 *   A) clamscan CLI (default). One-shot subprocess per file. Slow because
 *      it loads the signature DB on every invocation. Suitable for low
 *      throughput / dev / CI.
 *
 *      Exit codes:
 *        0 — clean
 *        1 — virus found
 *        2 — error (DB load fail, IO error, …)
 *
 *   B) clamd TCP INSTREAM. Persistent daemon, signatures pre-loaded; the
 *      adapter streams the file bytes over TCP using ClamAV's documented
 *      INSTREAM protocol [1] and parses the response. No npm dependency —
 *      `node:net` is enough.
 *
 *        Wire format (zINSTREAM\0):
 *          C → S: "zINSTREAM\0"
 *          C → S: <uint32 BE length><N bytes of file>   (repeat)
 *          C → S: <uint32 BE 0>                          (terminator)
 *          S → C: ASCII line, ending with NUL byte. Examples:
 *                 "stream: OK\0"                        → CLEAN
 *                 "stream: Eicar-Test-Signature FOUND\0" → INFECTED
 *                 "stream: <reason> ERROR\0"            → FAILED
 *
 *      [1] https://docs.clamav.net/manual/Usage/Configuration.html#clamd
 *
 * Selection: when `useClamd` is true (or env CLAMD_HOST is set we still
 * default to the CLI unless `useClamd` is explicit) the adapter uses path
 * B. Otherwise it falls back to path A. `CLAMAV_ENABLED!='1'` → always
 * SKIPPED, never throws.
 *
 * Returned shape is intentionally narrow — the worker layer (scan-worker.ts)
 * is responsible for translating outcomes into Attachment row updates and
 * notifications.
 */

import { execa } from 'execa';
import { promises as fs } from 'node:fs';
import net from 'node:net';

export type ClamScanStatus = 'CLEAN' | 'INFECTED' | 'FAILED' | 'SKIPPED';

export interface ScanFileOptions {
  /** Override path to the clamscan binary (default: env CLAMAV_BIN_PATH or 'clamscan'). */
  clamavBin?: string;
  /** When true, talk to clamd over TCP instead of forking clamscan. */
  useClamd?: boolean;
  /** clamd host (default: env CLAMD_HOST). */
  clamdHost?: string;
  /** clamd port (default: env CLAMD_PORT or 3310). */
  clamdPort?: number;
  /** Hard timeout in ms (default 120s). */
  timeoutMs?: number;
}

export interface ScanFileResult {
  status: ClamScanStatus;
  /** Signature name when status === 'INFECTED'. */
  signature?: string;
  /** Human-readable reason when status === 'FAILED' or 'SKIPPED'. */
  reason?: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CLAMD_PORT = 3310;
/**
 * INSTREAM chunk size. ClamAV's default StreamMaxLength is 25 MiB; we keep
 * chunks well under that so a single chunk never bumps into per-message
 * size limits. 64 KiB is a comfortable middle ground that also bounds RAM
 * if the daemon is slow to drain.
 */
const INSTREAM_CHUNK_BYTES = 64 * 1024;

/**
 * Scan a file at `inputPath` for viruses. Never throws — ClamAV failures
 * are returned as `{ status: 'FAILED', reason }` so the BullMQ retry
 * decision lives entirely in the caller.
 *
 * Behavior matrix:
 *   - `CLAMAV_ENABLED !== '1'`  → SKIPPED (no subprocess spawned)
 *   - `useClamd === true`       → clamd TCP INSTREAM (path B)
 *   - else                      → clamscan subprocess (path A)
 */
export async function scanFile(
  inputPath: string,
  opts: ScanFileOptions = {},
): Promise<ScanFileResult> {
  const start = Date.now();

  if (process.env.CLAMAV_ENABLED !== '1') {
    return {
      status: 'SKIPPED',
      reason: "CLAMAV_ENABLED!='1'",
      durationMs: Date.now() - start,
    };
  }

  // Confirm the file is readable up front. If we can't even open it, no
  // point invoking clamscan or talking to clamd.
  try {
    await fs.access(inputPath);
  } catch (err) {
    return {
      status: 'FAILED',
      reason: `input not readable: ${(err as Error).message}`,
      durationMs: Date.now() - start,
    };
  }

  const useClamd = opts.useClamd ?? process.env.CLAMAV_USE_CLAMD === '1';

  if (useClamd) {
    return scanViaClamd(inputPath, opts, start);
  }
  return scanViaClamscan(inputPath, opts, start);
}

// ───────────────────────────────────────────────────────────────────────────
// Path A — clamscan CLI subprocess
// ───────────────────────────────────────────────────────────────────────────

async function scanViaClamscan(
  inputPath: string,
  opts: ScanFileOptions,
  start: number,
): Promise<ScanFileResult> {
  const bin =
    opts.clamavBin ?? process.env.CLAMAV_BIN_PATH ?? 'clamscan';

  try {
    const { exitCode, stdout, stderr } = await execa(
      bin,
      ['--no-summary', '--stdout', inputPath],
      {
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        // Don't throw on non-zero — exit 1 is the legitimate "infected"
        // signal. We translate exit codes ourselves.
        reject: false,
      },
    );

    if (exitCode === 0) {
      return { status: 'CLEAN', durationMs: Date.now() - start };
    }

    if (exitCode === 1) {
      // Format: "<path>: <Signature> FOUND"
      // We extract the first signature for the row's virusScanSig column.
      const sig = parseClamscanSignature(stdout ?? '');
      return {
        status: 'INFECTED',
        signature: sig,
        durationMs: Date.now() - start,
      };
    }

    // exit 2 (or anything else) — engine error.
    const reason =
      (stderr ?? '').toString().trim() ||
      (stdout ?? '').toString().trim() ||
      `clamscan exited ${exitCode}`;
    return {
      status: 'FAILED',
      reason: reason.slice(0, 500),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    // Sync-ish errors (ENOENT for the binary, timeout, etc.). Map ENOENT
    // to a SKIPPED outcome — operators may run the worker on a host
    // without clamscan installed and we don't want every job to fail
    // loudly. CLAMAV_ENABLED guards intent; missing binary is a config
    // bug worth surfacing in logs but not worth retry storms.
    const errCode =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (errCode === 'ENOENT') {
      return {
        status: 'SKIPPED',
        reason: `clamscan binary not found at "${bin}" — set CLAMAV_BIN_PATH or unset CLAMAV_ENABLED`,
        durationMs: Date.now() - start,
      };
    }
    return {
      status: 'FAILED',
      reason: (err as Error).message ?? String(err),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Parse the FIRST signature name out of a clamscan stdout block.
 * Lines look like `<path>: <Signature> FOUND` (clamscan ≥0.103). Returns
 * `undefined` when no signature line is present (e.g. error output).
 */
export function parseClamscanSignature(stdout: string): string | undefined {
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const m = /:\s*(.+?)\s+FOUND\s*$/.exec(line);
    if (m && m[1]) return m[1].trim();
  }
  return undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Path B — clamd TCP INSTREAM
// ───────────────────────────────────────────────────────────────────────────

async function scanViaClamd(
  inputPath: string,
  opts: ScanFileOptions,
  start: number,
): Promise<ScanFileResult> {
  const host = opts.clamdHost ?? process.env.CLAMD_HOST ?? '127.0.0.1';
  const port = opts.clamdPort ?? Number(process.env.CLAMD_PORT ?? DEFAULT_CLAMD_PORT);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let buf: Buffer;
  try {
    buf = await fs.readFile(inputPath);
  } catch (err) {
    return {
      status: 'FAILED',
      reason: `read failed: ${(err as Error).message}`,
      durationMs: Date.now() - start,
    };
  }

  let response: string;
  try {
    response = await instream(host, port, buf, timeoutMs);
  } catch (err) {
    const errCode =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: unknown }).code
        : undefined;
    // ECONNREFUSED / ENOTFOUND → daemon not running. Return SKIPPED so
    // ops can spot the misconfiguration in logs without retry storms.
    if (errCode === 'ECONNREFUSED' || errCode === 'ENOTFOUND') {
      return {
        status: 'SKIPPED',
        reason: `clamd unreachable at ${host}:${port} (${String(errCode)})`,
        durationMs: Date.now() - start,
      };
    }
    return {
      status: 'FAILED',
      reason: (err as Error).message ?? String(err),
      durationMs: Date.now() - start,
    };
  }

  return interpretClamdResponse(response, start);
}

/**
 * Parse a clamd INSTREAM response line into a ScanFileResult.
 *
 * Examples handled:
 *   "stream: OK"                              → CLEAN
 *   "stream: Eicar-Test-Signature FOUND"      → INFECTED + signature
 *   "stream: <reason> ERROR"                  → FAILED + reason
 *   "INSTREAM size limit exceeded. ERROR"     → FAILED + reason
 *
 * Exported for unit tests.
 */
export function interpretClamdResponse(
  raw: string,
  startedAt: number,
): ScanFileResult {
  const cleaned = raw.replace(/\0+$/, '').trim();

  if (/(^|: )OK$/i.test(cleaned)) {
    return { status: 'CLEAN', durationMs: Date.now() - startedAt };
  }

  // Strip a leading "stream:" / "<path>:" preamble so the signature we
  // capture isn't accidentally prefixed with "stream: …".
  const withoutPreamble = cleaned.replace(/^[^:]*:\s*/, '');
  const found = /^(.+?)\s+FOUND$/i.exec(withoutPreamble);
  if (found) {
    return {
      status: 'INFECTED',
      signature: found[1]?.trim(),
      durationMs: Date.now() - startedAt,
    };
  }

  if (/ERROR$/i.test(cleaned)) {
    return {
      status: 'FAILED',
      reason: cleaned.slice(0, 500),
      durationMs: Date.now() - startedAt,
    };
  }

  // Unknown response shape — treat as failure. Better than silently
  // marking CLEAN.
  return {
    status: 'FAILED',
    reason: `unrecognised clamd response: ${cleaned.slice(0, 200)}`,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Minimal clamd INSTREAM client. Returns the raw ASCII response (NUL-
 * terminated and any trailing whitespace included; caller normalises).
 *
 * Implementation notes:
 *   - We send the literal command "zINSTREAM\0" (the 'z' prefix tells
 *     clamd to terminate replies with NUL instead of newline; works
 *     on every clamd ≥ 0.95).
 *   - Chunks are length-prefixed with a uint32 BE; a zero-length chunk
 *     terminates the stream.
 *   - We accumulate response bytes until the socket ends OR a NUL is
 *     seen. clamd can hang up before sending NUL on errors, so 'end'
 *     is also a terminator.
 *   - The `timeoutMs` budget covers the entire round-trip.
 */
function instream(
  host: string,
  port: number,
  buf: Buffer,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const chunks: Buffer[] = [];

    const finish = (
      ok: boolean,
      value: string | Error,
    ): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (ok) resolve(value as string);
      else reject(value as Error);
    };

    const timer = setTimeout(() => {
      finish(false, new Error(`clamd timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on('error', (err) => {
      clearTimeout(timer);
      finish(false, err);
    });

    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      // clamd terminates 'z' replies with a NUL byte. We only read up
      // to the first NUL — anything after is noise.
      if (chunk.includes(0)) {
        clearTimeout(timer);
        finish(true, Buffer.concat(chunks).toString('utf8'));
      }
    });

    socket.on('end', () => {
      // Daemon closed without sending NUL — accept whatever we have,
      // interpretation step will translate to FAILED if unparseable.
      clearTimeout(timer);
      finish(true, Buffer.concat(chunks).toString('utf8'));
    });

    socket.connect(port, host, () => {
      // Command byte sequence + chunked file body + 0-length terminator.
      socket.write('zINSTREAM\0');

      let offset = 0;
      while (offset < buf.length) {
        const end = Math.min(offset + INSTREAM_CHUNK_BYTES, buf.length);
        const slice = buf.subarray(offset, end);
        const lenHeader = Buffer.allocUnsafe(4);
        lenHeader.writeUInt32BE(slice.length, 0);
        socket.write(lenHeader);
        socket.write(slice);
        offset = end;
      }

      // Zero-length chunk → end of stream.
      const term = Buffer.allocUnsafe(4);
      term.writeUInt32BE(0, 0);
      socket.write(term);
    });
  });
}
