'use client';

/**
 * PrintLayout — print-only DOM populated when the user clicks the toolbar's
 * Print button.
 *
 * Strategy:
 *  1. Capture the current canvas to a PNG data URL (snapshotting whatever the
 *     user is looking at — page, rotation, layer toggles).
 *  2. Render an off-screen container that becomes visible only via the
 *     `@media print` rule below.
 *  3. Call window.print().
 *
 * Why image-based? PDF.js and dxf-viewer both render to canvas — replicating
 * their state into an SVG/HTML representation suitable for paged print would
 * require substantial work. A raster snapshot is good enough for the v1 use
 * case (an A4/A3 hard copy with title block).
 */

import { useEffect, useState } from 'react';

import type { AttachmentMeta } from '@/lib/viewer/types';

export interface PrintHandle {
  print: () => void;
}

export interface PrintLayoutProps {
  meta: AttachmentMeta | null;
  /** Producer that returns a PNG data URL of the current viewer frame. */
  captureFrame: () => string | null;
}

/**
 * Hook+component combo: exposes a `print` function via state.
 */
export function PrintLayout({ meta, captureFrame }: PrintLayoutProps) {
  const [snapshot, setSnapshot] = useState<string | null>(null);

  useEffect(() => {
    const onBeforePrint = () => {
      // If a sibling (toolbar) prepped a snapshot, use it; otherwise capture
      // synchronously here. Either path covers Ctrl+P from the keyboard.
      const stash =
        (window as unknown as { __viewerPrintSnapshot?: string })
          .__viewerPrintSnapshot ?? null;
      const current = stash ?? captureFrame();
      if (current) setSnapshot(current);
    };
    const onAfterPrint = () => {
      (window as unknown as { __viewerPrintSnapshot?: string })
        .__viewerPrintSnapshot = undefined;
    };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, [captureFrame]);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="viewer-print-only" aria-hidden>
        <div className="viewer-print-titleblock">
          <div>
            <strong>도면번호:</strong>{' '}
            <span>{meta?.objectNumber ?? '—'}</span>
          </div>
          <div>
            <strong>자료명:</strong> <span>{meta?.objectName ?? '—'}</span>
          </div>
          <div>
            <strong>인쇄 시각:</strong>{' '}
            <span>{new Date().toLocaleString('ko-KR')}</span>
          </div>
        </div>
        {snapshot ? (
          <img
            src={snapshot}
            alt={meta?.objectName ?? '도면 인쇄본'}
            className="viewer-print-image"
          />
        ) : (
          <div className="viewer-print-empty">미리보기 없음</div>
        )}
      </div>
    </>
  );
}

/**
 * Trigger a print run from outside this component. We capture the frame
 * synchronously (so what the user sees is what they get), stash it on a
 * hidden DOM node managed via state, then call window.print().
 */
export function triggerPrint(captureFrame: () => string | null): void {
  // We rely on the `beforeprint` listener (above) to refresh the snapshot.
  // Direct printing always proceeds; if capture fails, the user sees a
  // "미리보기 없음" placeholder.
  const url = captureFrame();
  if (!url) {
    // Still print the title block; the placeholder will show.
    window.print();
    return;
  }
  // Stash on a global so the listener (if mounted later) can pick it up.
  (window as unknown as { __viewerPrintSnapshot?: string }).__viewerPrintSnapshot = url;
  window.print();
}

const PRINT_CSS = `
.viewer-print-only {
  display: none;
}

@media print {
  /* Hide everything except the print container */
  body * {
    visibility: hidden;
  }
  .viewer-print-only,
  .viewer-print-only * {
    visibility: visible;
  }
  .viewer-print-only {
    display: block;
    position: fixed;
    inset: 0;
    background: white;
    color: black;
  }
  .viewer-print-titleblock {
    display: flex;
    gap: 1.5rem;
    padding: 12px 16px;
    border-bottom: 1px solid #000;
    font-size: 11pt;
    font-family: -apple-system, system-ui, sans-serif;
  }
  .viewer-print-image {
    display: block;
    width: 100%;
    max-height: calc(100vh - 60px);
    object-fit: contain;
    page-break-inside: avoid;
  }
  .viewer-print-empty {
    padding: 4rem;
    text-align: center;
    font-size: 14pt;
    color: #666;
  }
  @page {
    margin: 12mm;
    size: A4 landscape;
  }
}
`;
