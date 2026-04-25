/**
 * PDF.js engine wrapper.
 *
 * - Lazy-loads `pdfjs-dist` so PDF code only ships when the viewer mounts
 *   (it's ~600KB+ minified).
 * - Wires the worker to a CDN URL whose version matches the locally installed
 *   `pdfjs-dist` package — pdf.worker.* is built from the same sources, and
 *   loading a mismatched worker version causes hard runtime errors.
 * - Provides only the surface the viewer UI actually uses: load, render,
 *   text-search via findController.
 *
 * The worker URL strategy: we read `pdfjs.version` at runtime (it's a string
 * exported from the entry) and template it into a jsdelivr URL. This avoids
 * needing a Next.js webpack rule to copy the worker file into /public, at the
 * cost of a CDN dependency. If the network is blocked, the user sees an
 * inline error and can still download the original file.
 */

'use client';

import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';

/** Lazy import handle — resolved once on first call. */
let pdfjsModulePromise: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = (async () => {
      // The legacy build avoids `import.meta.url` worker resolution that breaks
      // under some bundler configs; the mjs entry is the modern API.
      const mod = await import('pdfjs-dist');
      // Configure worker once. jsdelivr exposes the package's own worker file.
      // If the worker URL doesn't match the lib version, PDF.js throws.
      const version = (mod as { version?: string }).version ?? '4.7.76';
      mod.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
      return mod;
    })();
  }
  return pdfjsModulePromise;
}

export interface PdfLoadOptions {
  /** Either a URL (preferred) or raw bytes. */
  url?: string;
  data?: Uint8Array;
  /** Send credentials with the request (cookies for our session). */
  withCredentials?: boolean;
}

/**
 * Load a PDF document. The returned document is a thin handle around
 * pdfjs-dist's PDFDocumentProxy — pass it back to {@link renderPage} etc.
 */
export async function loadPdf(opts: PdfLoadOptions): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    url: opts.url,
    data: opts.data,
    withCredentials: opts.withCredentials ?? true,
    isEvalSupported: false,
    disableAutoFetch: false,
    disableStream: false,
  });
  return task.promise;
}

export interface RenderOptions {
  /** Target canvas — sized internally to match the requested scale * page. */
  canvas: HTMLCanvasElement;
  /** Optional text-layer container — populated with selectable spans. */
  textLayerContainer?: HTMLDivElement | null;
  /** 1-based page number. */
  pageNum: number;
  /** Multiplier on intrinsic page size. */
  scale: number;
  /** Rotation in degrees (0/90/180/270). Added to the page's intrinsic rotation. */
  rotation: number;
  /** Optional device-pixel-ratio override (for high-DPI). Defaults to window.devicePixelRatio. */
  dpr?: number;
}

export interface RenderResult {
  /** Width/height in CSS pixels (before DPR scaling). */
  cssWidth: number;
  cssHeight: number;
  /** The active render task — call .cancel() if a re-render races in. */
  task: RenderTask;
  page: PDFPageProxy;
  /** Viewport used (useful for screen↔page coordinate conversion). */
  viewport: ReturnType<PDFPageProxy['getViewport']>;
}

/**
 * Internal renderPage that takes the document explicitly. Public callers go
 * through {@link createPdfRenderer} which wraps this with a bound `doc`.
 */
async function _renderPageInternal(
  pdfjs: typeof import('pdfjs-dist'),
  doc: PDFDocumentProxy,
  opts: RenderOptions,
): Promise<RenderResult> {
  const page = await doc.getPage(opts.pageNum);
  const viewport = page.getViewport({
    scale: opts.scale,
    rotation: opts.rotation,
  });
  const dpr = opts.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  const cssWidth = viewport.width;
  const cssHeight = viewport.height;

  const canvas = opts.canvas;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not get 2D context');

  const transform: number[] | undefined =
    dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0];

  // pdfjs-dist 4.x accepts canvasContext + viewport. The cast keeps us
  // compatible across patch versions where field optionality has shifted.
  const task = page.render({
    canvasContext: ctx,
    viewport,
    transform,
  } as Parameters<PDFPageProxy['render']>[0]);

  // Optional text layer (used for selection + search highlight).
  if (opts.textLayerContainer) {
    const tl = opts.textLayerContainer;
    tl.innerHTML = '';
    tl.style.width = `${cssWidth}px`;
    tl.style.height = `${cssHeight}px`;
    void task.promise.then(async () => {
      try {
        const textContent = await page.getTextContent();
        // Prefer the new TextLayer class (pdfjs 4.x); fall back to the old
        // renderTextLayer function. Either way, it's best-effort — if both
        // are missing, the page still renders, just without selectable text.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const TextLayerCls = (pdfjs as any).TextLayer as
          | (new (args: {
              textContentSource: unknown;
              container: HTMLElement;
              viewport: unknown;
            }) => { render: () => Promise<void> })
          | undefined;
        if (TextLayerCls) {
          const layer = new TextLayerCls({
            textContentSource: textContent,
            container: tl,
            viewport,
          });
          await layer.render();
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const renderTextLayer = (pdfjs as any).renderTextLayer as
          | ((args: {
              textContent: unknown;
              container: HTMLElement;
              viewport: unknown;
              textDivs: unknown[];
            }) => { promise: Promise<void> })
          | undefined;
        if (renderTextLayer) {
          const textDivs: unknown[] = [];
          await renderTextLayer({
            textContent,
            container: tl,
            viewport,
            textDivs,
          }).promise;
        }
      } catch {
        // Text layer is best-effort; render is fine even if this fails.
      }
    });
  }

  return { cssWidth, cssHeight, task, page, viewport };
}

/**
 * Build a renderer bound to a document. This is the public surface — keep the
 * doc opaque and expose only the methods the UI needs.
 */
export interface PdfRenderer {
  doc: PDFDocumentProxy;
  numPages: number;
  renderPage: (opts: Omit<RenderOptions, never>) => Promise<RenderResult>;
  /**
   * Run a text query over all pages and return a flat array of hits.
   * Each hit: { page, str, matchIndex }. Best-effort; falls back to a manual
   * scan when findController isn't available (it's an internal API of the
   * default viewer in pdfjs-dist).
   */
  searchText: (query: string) => Promise<PdfSearchHit[]>;
  destroy: () => Promise<void>;
}

export interface PdfSearchHit {
  page: number;
  /** Index of the match within the page's normalized text. */
  charIndex: number;
  /** A short surrounding snippet for the results panel. */
  snippet: string;
}

export async function createPdfRenderer(
  doc: PDFDocumentProxy,
): Promise<PdfRenderer> {
  const pdfjs = await loadPdfjs();
  return {
    doc,
    numPages: doc.numPages,
    renderPage: (opts) => _renderPageInternal(pdfjs, doc, opts),
    searchText: async (query) => searchPdfText(doc, query),
    destroy: async () => {
      try {
        await doc.destroy();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Best-effort text search: enumerate page text content and find substring
 * matches case-insensitively. We don't use pdfjs's findController because
 * it's tightly coupled to the default web viewer's DOM.
 */
async function searchPdfText(
  doc: PDFDocumentProxy,
  query: string,
): Promise<PdfSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const hits: PdfSearchHit[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items as Array<{ str?: string }>;
    const flat = items.map((i) => i.str ?? '').join(' ');
    const flatLower = flat.toLowerCase();
    let idx = 0;
    while (idx < flatLower.length) {
      const found = flatLower.indexOf(lower, idx);
      if (found < 0) break;
      const start = Math.max(0, found - 24);
      const end = Math.min(flat.length, found + q.length + 24);
      hits.push({
        page: p,
        charIndex: found,
        snippet:
          (start > 0 ? '…' : '') +
          flat.slice(start, end) +
          (end < flat.length ? '…' : ''),
      });
      idx = found + q.length;
    }
  }
  return hits;
}
