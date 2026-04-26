'use client';

/**
 * Promise wrapper around `dxf-worker.ts`. The client lazy-instantiates the
 * worker on first parse so a viewer route that never renders the in-house
 * engine doesn't pay for it.
 *
 * Falls back to a synchronous `parseDxf` import when:
 *   - `Worker` is undefined (SSR / older runtimes)
 *   - `new URL('./dxf-worker.ts', import.meta.url)` fails (rare; usually a
 *     bundler quirk)
 *
 * The fallback keeps the viewer correct at the cost of main-thread blocking
 * — better a slow render than a hard failure.
 */

import { parseDxf, type DxfDocument } from '@/lib/dxf-parser';

interface InflightParse {
  resolve: (doc: DxfDocument) => void;
  reject: (err: Error) => void;
}

let workerSingleton: Worker | null = null;
let workerUnusable = false;
const inflight = new Map<string, InflightParse>();

function ensureWorker(): Worker | null {
  if (workerUnusable) return null;
  if (workerSingleton) return workerSingleton;
  if (typeof Worker === 'undefined') {
    workerUnusable = true;
    return null;
  }
  try {
    workerSingleton = new Worker(
      new URL('./dxf-worker.ts', import.meta.url),
      { type: 'module' },
    );
  } catch {
    workerUnusable = true;
    return null;
  }
  workerSingleton.addEventListener(
    'message',
    (event: MessageEvent<{
      type: 'parsed' | 'error';
      id: string;
      doc?: DxfDocument;
      message?: string;
    }>) => {
      const data = event.data;
      const pending = inflight.get(data.id);
      if (!pending) return;
      inflight.delete(data.id);
      if (data.type === 'parsed' && data.doc) {
        pending.resolve(data.doc);
      } else {
        pending.reject(new Error(data.message ?? 'DXF parse failed'));
      }
    },
  );
  workerSingleton.addEventListener('error', () => {
    // Reject every pending parse so we don't dangle promises forever, then
    // mark the worker unusable so the next call falls back to sync.
    for (const [id, p] of inflight) {
      p.reject(new Error('DXF worker crashed'));
      inflight.delete(id);
    }
    workerSingleton = null;
    workerUnusable = true;
  });
  return workerSingleton;
}

let counter = 0;

export async function parseDxfAsync(text: string): Promise<DxfDocument> {
  const worker = ensureWorker();
  if (!worker) {
    // Fallback: synchronous parse on the calling thread. Yield once so the
    // surrounding React render flushes before we hog the CPU.
    await Promise.resolve();
    return parseDxf(text);
  }
  const id = `parse-${++counter}`;
  return new Promise<DxfDocument>((resolve, reject) => {
    inflight.set(id, { resolve, reject });
    worker.postMessage({ type: 'parse', id, text });
  });
}
