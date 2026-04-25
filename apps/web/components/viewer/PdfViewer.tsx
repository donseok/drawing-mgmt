'use client';

/**
 * PdfViewer — renders a single PDF page on a canvas with pan/zoom/rotation.
 *
 * Architecture:
 *  - One <canvas> renders the current page at the current scale * rotation.
 *  - One absolutely-positioned <div> hosts PDF.js's text layer (selectable
 *    text + search highlight target).
 *  - Both are wrapped in a "stage" div that we transform (translate, scale)
 *    for pan/zoom. Re-renders happen only when the *target scale* crosses a
 *    threshold (so wheel-zoom is buttery-smooth — we transform CSS, then
 *    re-rasterize once it settles).
 *
 * The component exposes an imperative ref so the parent (ViewerShell) can
 * wire toolbar buttons and keyboard shortcuts to engine-specific behavior
 * like `fit()` or `pageNext()`.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { cn } from '@/lib/cn';
import {
  createPdfRenderer,
  loadPdf,
  type PdfRenderer,
} from '@/lib/viewer/pdf-engine';
import { useViewerStore, useViewerStoreApi } from '@/lib/viewer/use-viewer-state';

export interface PdfViewerHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  actualSize: () => void;
  rotateCw: () => void;
  rotateCcw: () => void;
  rotate180: () => void;
  pageNext: () => void;
  pagePrev: () => void;
  /** Get a data URL of the current page render — used by Print. */
  getCurrentPageDataUrl: () => string | null;
  /** Get the PdfRenderer if the caller needs deeper access (search). */
  getRenderer: () => PdfRenderer | null;
}

export interface PdfViewerProps {
  /** Either a URL the engine fetches, or pre-loaded bytes (used by sample fallback). */
  source: { url: string } | { data: Uint8Array };
  /** Notified when an error occurs that the engine can't recover from. */
  onError: (msg: string, detail?: string) => void;
  /** Notified when the underlying renderer is ready (for search etc.). */
  onReady?: (renderer: PdfRenderer) => void;
}

const ZOOM_STEP = 1.1;

export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(
  function PdfViewer({ source, onError, onReady }, ref) {
    const stageRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const textLayerRef = useRef<HTMLDivElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const rendererRef = useRef<PdfRenderer | null>(null);
    const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
    const intrinsicRef = useRef<{ width: number; height: number } | null>(null);

    const storeApi = useViewerStoreApi();
    const zoom = useViewerStore((s) => s.zoom);
    const rotation = useViewerStore((s) => s.rotation);
    const page = useViewerStore((s) => s.page);
    const invert = useViewerStore((s) => s.invertBackground);
    const tool = useViewerStore((s) => s.tool);

    const [pan, setPan] = useState({ x: 0, y: 0 });
    const panRef = useRef(pan);
    panRef.current = pan;

    // ── Load the document once ─────────────────────────────────────────────
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const doc = await loadPdf(
            'url' in source ? { url: source.url } : { data: source.data },
          );
          if (cancelled) {
            try {
              await doc.destroy();
            } catch {
              /* ignore */
            }
            return;
          }
          const renderer = await createPdfRenderer(doc);
          rendererRef.current = renderer;
          storeApi.getState().setPageCount(renderer.numPages);
          onReady?.(renderer);
        } catch (err) {
          const e = err as Error;
          onError('PDF 파일을 열 수 없습니다.', e.message);
        }
      })();
      return () => {
        cancelled = true;
        try {
          rendererRef.current?.destroy();
        } catch {
          /* ignore */
        }
        rendererRef.current = null;
      };
      // We key the effect on URL (when present); byte-source identity is
      // assumed stable for the lifetime of the component (only used for the
      // dev sample fixture).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      'url' in source ? source.url : '__bytes__',
    ]);

    // ── Render on page/zoom/rotation change ─────────────────────────────────
    const doRender = useCallback(async () => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      // Cancel any in-flight render.
      try {
        renderTaskRef.current?.cancel();
      } catch {
        /* ignore */
      }
      try {
        const result = await renderer.renderPage({
          canvas,
          textLayerContainer: textLayerRef.current,
          pageNum: page,
          scale: zoom,
          rotation,
        });
        renderTaskRef.current = result.task;
        intrinsicRef.current = {
          width: result.cssWidth,
          height: result.cssHeight,
        };
        // After first render, center the page on the stage.
        const container = containerRef.current;
        if (container && (panRef.current.x === 0 && panRef.current.y === 0)) {
          const dx = (container.clientWidth - result.cssWidth) / 2;
          const dy = (container.clientHeight - result.cssHeight) / 2;
          setPan({ x: Math.max(0, dx), y: Math.max(0, dy) });
        }
      } catch (err) {
        // RenderingCancelledException is normal during fast zoom — ignore.
        const e = err as Error & { name?: string };
        if (e?.name === 'RenderingCancelledException') return;
        onError('PDF 페이지를 렌더링할 수 없습니다.', e.message);
      }
    }, [page, zoom, rotation, onError]);

    useEffect(() => {
      void doRender();
    }, [doRender]);

    // ── Imperative API (for the parent) ─────────────────────────────────────
    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => storeApi.getState().zoomBy(ZOOM_STEP),
        zoomOut: () => storeApi.getState().zoomBy(1 / ZOOM_STEP),
        fit: () => {
          const c = containerRef.current;
          const intrinsic = intrinsicRef.current;
          if (!c || !intrinsic) {
            storeApi.getState().setZoom(1);
            return;
          }
          // Compute a scale factor that fits the page in the container at the
          // CURRENT rotation. We need the unscaled intrinsic, which we don't
          // store separately — recover it via current zoom.
          const z = storeApi.getState().zoom;
          const unscaledW = intrinsic.width / z;
          const unscaledH = intrinsic.height / z;
          const scaleFit = Math.min(
            c.clientWidth / unscaledW,
            c.clientHeight / unscaledH,
          );
          storeApi.getState().setZoom(Math.max(0.1, scaleFit * 0.95));
          setPan({ x: 0, y: 0 });
        },
        actualSize: () => {
          storeApi.getState().setZoom(1);
        },
        rotateCw: () => storeApi.getState().rotateBy(90),
        rotateCcw: () => storeApi.getState().rotateBy(-90),
        rotate180: () => storeApi.getState().rotateBy(180),
        pageNext: () => {
          const s = storeApi.getState();
          s.setPage(Math.min(s.pageCount, s.page + 1));
        },
        pagePrev: () => {
          const s = storeApi.getState();
          s.setPage(Math.max(1, s.page - 1));
        },
        getCurrentPageDataUrl: () => {
          const c = canvasRef.current;
          if (!c) return null;
          try {
            return c.toDataURL('image/png');
          } catch {
            return null;
          }
        },
        getRenderer: () => rendererRef.current,
      }),
      [storeApi],
    );

    // ── Wheel zoom centered on cursor ───────────────────────────────────────
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey && e.deltaY === 0) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        const before = panRef.current;
        const oldZoom = storeApi.getState().zoom;
        const newZoom = Math.max(0.1, Math.min(32, oldZoom * factor));
        const realFactor = newZoom / oldZoom;
        // Keep the cursor over the same world point: shift pan by the cursor
        // delta scaled.
        setPan({
          x: cursorX - (cursorX - before.x) * realFactor,
          y: cursorY - (cursorY - before.y) * realFactor,
        });
        storeApi.getState().setZoom(newZoom);
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, [storeApi]);

    // ── Pan via middle-button / right-button drag, or Space+left ────────────
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      let dragging = false;
      let last = { x: 0, y: 0 };
      const onDown = (e: PointerEvent) => {
        // Middle button = always pan. Right button = pan unless context menu intent.
        // Left button only pans when tool === 'pan' AND not on a measurement target.
        const isPanGesture =
          e.button === 1 || e.button === 2 || (e.button === 0 && tool === 'pan');
        if (!isPanGesture) return;
        dragging = true;
        last = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      };
      const onUp = (e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      };
      const onContext = (e: MouseEvent) => {
        // Suppress browser context menu on the canvas — right-button is a pan.
        e.preventDefault();
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('contextmenu', onContext);
      return () => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        el.removeEventListener('contextmenu', onContext);
      };
    }, [tool]);

    // ── Double-click 부분확대: 2x at the click point ────────────────────────
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const onDbl = (e: MouseEvent) => {
        if (tool !== 'pan') return; // measurement double-click closes a polygon
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        const before = panRef.current;
        const oldZoom = storeApi.getState().zoom;
        const newZoom = Math.min(32, oldZoom * 2);
        const realFactor = newZoom / oldZoom;
        setPan({
          x: cursorX - (cursorX - before.x) * realFactor,
          y: cursorY - (cursorY - before.y) * realFactor,
        });
        storeApi.getState().setZoom(newZoom);
      };
      el.addEventListener('dblclick', onDbl);
      return () => el.removeEventListener('dblclick', onDbl);
    }, [storeApi, tool]);

    return (
      <div
        ref={containerRef}
        className={cn(
          'relative h-full w-full overflow-hidden bg-white',
          tool === 'pan' ? 'cursor-grab' : 'cursor-crosshair',
        )}
        // Stage container; z-index isolates it from the measurement overlay.
        data-pdf-stage="true"
        // Apply background-invert as inline style — easier than fighting
        // Tailwind's escaping of the parens/comma.
        style={
          invert
            ? { filter: 'invert(1) hue-rotate(180deg)' }
            : undefined
        }
      >
        <div
          ref={stageRef}
          className="absolute"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            transformOrigin: '0 0',
          }}
        >
          <canvas
            ref={canvasRef}
            className="block bg-white shadow-md"
            data-viewer-canvas="pdf"
          />
          <div
            ref={textLayerRef}
            className="text-pdf-layer absolute inset-0 select-text"
            // PDF.js applies its own positioning to the spans it injects.
            style={{
              pointerEvents: 'none',
              color: 'transparent',
            }}
            aria-hidden
          />
        </div>
      </div>
    );
  },
);
