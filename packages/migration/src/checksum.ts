// SHA-256 helpers for migration artifacts.
//
// The pipeline checksums files at three points:
//   1. At the source: `Source.resolveFile` returns the buffer + computed
//      hash. This is the "what TeamPlus says it has" baseline.
//   2. At copy time: the loader writes the buffer to disk and re-hashes the
//      written file. If they don't match, we mark the attachment as
//      MIGRATION_CHECKSUM_MISMATCH and surface it in the report.
//   3. At verify time: the verify command re-hashes the destination file
//      and compares against the row's `checksumSha256` column.
//
// All three paths stream from the buffer or disk to keep memory low.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export function sha256OfBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
