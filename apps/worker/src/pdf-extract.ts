/**
 * R40 S-1 — Worker-side PDF body text extraction core.
 *
 * Pure function entry point: takes a Buffer of PDF bytes and returns the
 * concatenated plain text from every page. Used by
 * `apps/worker/src/pdf-extract-worker.ts` after fetching bytes from the
 * storage abstraction.
 *
 * Library: `pdfjs-dist/legacy/build/pdf.mjs` (Apache 2.0). The "legacy"
 * build is the pdfjs entry point intended for Node — it ships with
 * polyfills baked in (DOMMatrix, etc.) so we don't have to wire any
 * canvas/jsdom shim. The non-legacy build assumes a browser global
 * environment and would crash on first import in our ESM Node 22 worker.
 *
 * License posture: Apache 2.0. No GPL/AGPL transitive deps; the canvas
 * binding (a common pdfjs companion in browsers) is NOT pulled in by the
 * legacy build because we never ask pdfjs to render — only to parse.
 *
 * Output shape: per-page items joined with single spaces, pages joined
 * with `\n\n`. We deliberately keep the format simple — Postgres'
 * `to_tsvector('simple', ...)` will tokenize on whitespace regardless,
 * and the FE only ever sees the snippet via `ts_headline`. Inserting
 * page numbers / hyphenation fixes / RTL handling is a follow-up.
 */

import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';

/**
 * Extract every page's text from a PDF Buffer. Returns the concatenated
 * plain text. Empty PDFs (no pages, or pages with no `TextItem` content)
 * resolve to an empty string — the caller is responsible for storing
 * `null` (or `''`) per its own policy.
 *
 * Throws when pdfjs-dist itself rejects the document (corrupted bytes,
 * unsupported encryption, etc.). The BullMQ worker translates the throw
 * into a job retry per the queue's `attempts` policy.
 */
export async function extractPdfText(pdfBytes: Buffer): Promise<string> {
  // Lazy-load pdfjs at call time — keeps the worker bootstrap cost flat
  // when PDF_EXTRACT_ENABLED=0 (the worker process never imports this
  // file in that path).
  //
  // The legacy build's package export is `.mjs`; we go through it
  // explicitly so TS resolution doesn't pick the browser-only entry.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Disable worker thread spawning. pdfjs uses a separate Worker for
  // CPU-intensive parsing in the browser; in our Node worker we already
  // run on a dedicated process, so `useWorker: false` keeps everything
  // on the main thread and avoids the extra ESM dance for the worker
  // entrypoint resolution.
  //
  // NOTE: pdfjs's Node typings still require Uint8Array for `data`; a
  // raw Buffer is structurally compatible (Node Buffer extends
  // Uint8Array) so the cast is safe.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    // pdfjs ≥ 4 exposes these as top-level constructor options.
    // Disable per-page rendering features we don't use to keep memory
    // tight — text-only extraction has no need for fonts/images.
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });

  const doc = await loadingTask.promise;
  try {
    const pageTexts: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      try {
        const content = await page.getTextContent();
        // `items` can include both TextItem (with `.str`) and
        // TextMarkedContent (without). Filter to TextItem and join the
        // raw `str` values with single spaces.
        const items = content.items as Array<TextItem | { type?: string }>;
        const pageStr = items
          .map((it) => ('str' in it ? it.str : ''))
          .filter((s): s is string => typeof s === 'string' && s.length > 0)
          .join(' ');
        if (pageStr.length > 0) pageTexts.push(pageStr);
      } finally {
        // Per pdfjs docs, pages should be cleaned up to release the
        // backing memory promptly — important for large multi-page
        // archive scans.
        page.cleanup();
      }
    }
    // Inter-page separator: `\n\n`. Tokenizers treat it as whitespace
    // (so it doesn't change the lexeme set) but it preserves a soft
    // page boundary in the stored `contentText` for any future
    // line-aware parsing.
    return pageTexts.join('\n\n');
  } finally {
    // Always destroy the document to release the worker's parse
    // buffers regardless of throw / success paths.
    await doc.destroy().catch(() => undefined);
  }
}
