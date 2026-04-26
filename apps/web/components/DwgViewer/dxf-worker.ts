// R13 — DXF parsing Web Worker.
//
// `parseDxf` is pure CPU work (string scan + entity object construction). On
// large drawings (~50k entities or ~5 MB DXF text) it can hog the main thread
// for hundreds of ms, freezing the UI during navigation. This worker moves
// the parse off the render thread; the main module talks to it through a
// promise-shaped helper in `dxf-worker-client.ts`.
//
// Schema:
//   IN  : { type: 'parse', id: string, text: string }
//   OUT : { type: 'parsed', id: string, doc: DxfDocument }
//       | { type: 'error',  id: string, message: string }
//
// The id round-trips so concurrent requests stay paired (the client only
// fires one parse at a time today, but rolling responses through ids keeps
// future fan-out cheap).

/// <reference lib="webworker" />

import { parseDxf } from '@/lib/dxf-parser';

interface ParseRequest {
  type: 'parse';
  id: string;
  text: string;
}
interface ParseResponse {
  type: 'parsed';
  id: string;
  doc: ReturnType<typeof parseDxf>;
}
interface ErrorResponse {
  type: 'error';
  id: string;
  message: string;
}

type Outgoing = ParseResponse | ErrorResponse;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<ParseRequest>) => {
  const data = event.data;
  if (!data || data.type !== 'parse') return;
  try {
    const doc = parseDxf(data.text);
    const reply: Outgoing = { type: 'parsed', id: data.id, doc };
    ctx.postMessage(reply);
  } catch (err) {
    const reply: Outgoing = {
      type: 'error',
      id: data.id,
      message: err instanceof Error ? err.message : 'DXF parse failed',
    };
    ctx.postMessage(reply);
  }
});

// Make TS treat this as a module so the global augmentation above doesn't
// leak into other files.
export {};
