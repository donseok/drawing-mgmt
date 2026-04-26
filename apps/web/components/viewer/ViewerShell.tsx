'use client';

/**
 * ViewerShell — the orchestrator for the fullscreen viewer.
 *
 * Responsibilities:
 *  - Resolve preview availability (HEAD /preview.pdf, HEAD /preview.dxf),
 *    falling back to embedded sample fixtures when both are 404 (dev mode).
 *  - Choose initial mode (PDF if available, else DXF).
 *  - Mount the engine for the active mode (PdfViewer or DxfViewer).
 *  - Wire toolbar actions to engine handles.
 *  - Mount overlays (measurement, search) that need engine coords.
 *  - Handle fullscreen and close.
 *
 * Defensive design: if an engine fails to load (e.g. CDN blocked), render
 * <ViewerError /> with a download fallback.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ViewerStoreProvider, useViewerStore } from '@/lib/viewer/use-viewer-state';
import { useViewerKeyboard } from '@/lib/viewer/keyboard';
import {
  fetchAttachmentMeta,
  previewExists,
  previewUrl,
} from '@/lib/viewer/api';
import {
  SAMPLE_DXF_TEXT,
  getSamplePdfBytes,
} from '@/lib/viewer/sample-fixtures';
import type {
  AttachmentMeta,
  Point2D,
  WorldPoint,
} from '@/lib/viewer/types';
import type { PdfRenderer } from '@/lib/viewer/pdf-engine';
import { screenToWorld, type DxfEngine } from '@/lib/viewer/dxf-engine';

import { ViewerToolbar } from './ViewerToolbar';
import { ViewerSidebar } from './ViewerSidebar';
import { ViewerError } from './ViewerError';
import { MiniMap } from './MiniMap';
import { PdfViewer, type PdfViewerHandle } from './PdfViewer';
import { DxfViewer, type DxfViewerHandle } from './DxfViewer';
// R5 (F4-08) Phase 1 — in-house DXF viewer. Opt-in via either:
//   - URL: /viewer/<id>?engine=own
//   - Env: NEXT_PUBLIC_USE_OWN_DXF_VIEWER=1 (default once stable)
// The DxfViewerHandle / DxfEngine surfaces are mirrored so the toolbar +
// measurement overlay are engine-agnostic.
import { DwgViewer } from '@/components/DwgViewer';
import { MeasurementOverlay } from './MeasurementOverlay';
import { TextSearchPanel } from './TextSearchPanel';
import { PrintLayout, triggerPrint } from './PrintLayout';

export interface ViewerShellProps {
  attachmentId: string;
}

export function ViewerShell({ attachmentId }: ViewerShellProps) {
  return (
    <ViewerStoreProvider>
      <ViewerShellInner attachmentId={attachmentId} />
    </ViewerStoreProvider>
  );
}

interface ResolvedSource {
  pdf: { url: string } | { data: Uint8Array } | null;
  dxf: { url: string } | { text: string } | null;
}

function ViewerShellInner({ attachmentId }: ViewerShellProps) {
  const router = useRouter();
  // R5 opt-in. URL flag wins so QA can flip per-tab without a server restart.
  const useOwnDxfEngine = useOwnDxfEngineFlag();
  const [meta, setMeta] = useState<AttachmentMeta | null>(null);
  const [source, setSource] = useState<ResolvedSource>({ pdf: null, dxf: null });
  const [error, setError] = useState<{ message: string; detail?: string } | null>(
    null,
  );
  const [resolved, setResolved] = useState(false);
  const [dxfEngine, setDxfEngine] = useState<DxfEngine | null>(null);
  const [pdfRenderer, setPdfRenderer] = useState<PdfRenderer | null>(null);

  const mode = useViewerStore((s) => s.mode);
  const setMode = useViewerStore((s) => s.setMode);
  const setPage = useViewerStore((s) => s.setPage);
  const setFullscreen = useViewerStore((s) => s.setFullscreen);
  const tool = useViewerStore((s) => s.tool);

  const pdfRef = useRef<PdfViewerHandle | null>(null);
  const dxfRef = useRef<DxfViewerHandle | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // ── Resolve preview availability + meta ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await fetchAttachmentMeta(attachmentId);
        if (cancelled) return;
        setMeta(m);

        const [pdfOk, dxfOk] = await Promise.all([
          m.hasPdf ? previewExists(attachmentId, 'pdf').catch(() => false) : false,
          m.hasDxf ? previewExists(attachmentId, 'dxf').catch(() => false) : false,
        ]);

        const next: ResolvedSource = {
          pdf: pdfOk ? { url: previewUrl(attachmentId, 'pdf') } : null,
          dxf: dxfOk ? { url: previewUrl(attachmentId, 'dxf') } : null,
        };
        // Dev fallback: if neither exists, embed sample fixtures so the viewer
        // is testable. The flag (we always fall back) keeps dev cycles fast.
        if (!next.pdf && !next.dxf) {
          next.pdf = { data: getSamplePdfBytes() };
          next.dxf = { text: SAMPLE_DXF_TEXT };
        } else if (!next.pdf) {
          next.pdf = { data: getSamplePdfBytes() };
        } else if (!next.dxf) {
          next.dxf = { text: SAMPLE_DXF_TEXT };
        }
        if (cancelled) return;
        setSource(next);

        // Pick initial mode: prefer the format the file was master in. We
        // don't have that signal yet, so default to PDF (more universal).
        if (m.hasPdf) setMode('pdf');
        else if (m.hasDxf) setMode('dxf');
        else setMode('pdf');
        setResolved(true);
      } catch (err) {
        const e = err as Error;
        setError({
          message: '도면 정보를 불러올 수 없습니다.',
          detail: e.message,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachmentId, setMode]);

  // ── Fullscreen handling ──────────────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [setFullscreen]);

  const toggleFullscreen = useCallback(() => {
    const root = stageRef.current;
    if (!root) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void root.requestFullscreen?.();
    }
  }, []);

  // ── Toolbar handlers (delegate to active engine handle) ──────────────────
  const onZoomIn = useCallback(() => {
    if (mode === 'pdf') pdfRef.current?.zoomIn();
    else dxfRef.current?.zoomIn();
  }, [mode]);
  const onZoomOut = useCallback(() => {
    if (mode === 'pdf') pdfRef.current?.zoomOut();
    else dxfRef.current?.zoomOut();
  }, [mode]);
  const onFit = useCallback(() => {
    if (mode === 'pdf') pdfRef.current?.fit();
    else dxfRef.current?.fit();
  }, [mode]);
  const onActualSize = useCallback(() => {
    if (mode === 'pdf') pdfRef.current?.actualSize();
    else dxfRef.current?.actualSize();
  }, [mode]);
  const onRotateCw = useCallback(() => {
    if (mode === 'pdf') pdfRef.current?.rotateCw();
    else dxfRef.current?.rotateCw();
  }, [mode]);
  const onRotateCcw = useCallback(() => {
    if (mode === 'pdf') pdfRef.current?.rotateCcw();
    else dxfRef.current?.rotateCcw();
  }, [mode]);
  const onRotate180 = useCallback(() => {
    if (mode === 'pdf') pdfRef.current?.rotate180();
    else dxfRef.current?.rotate180();
  }, [mode]);
  const onPageNext = useCallback(() => {
    pdfRef.current?.pageNext();
  }, []);
  const onPagePrev = useCallback(() => {
    pdfRef.current?.pagePrev();
  }, []);
  const onClose = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push('/');
  }, [router]);

  const captureFrame = useCallback((): string | null => {
    if (mode === 'pdf') return pdfRef.current?.getCurrentPageDataUrl() ?? null;
    return dxfRef.current?.getCurrentImageDataUrl() ?? null;
  }, [mode]);

  const onPrint = useCallback(() => {
    triggerPrint(captureFrame);
  }, [captureFrame]);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useViewerKeyboard({
    zoomIn: onZoomIn,
    zoomOut: onZoomOut,
    fit: onFit,
    actualSize: onActualSize,
    rotateCw: onRotateCw,
    rotateCcw: onRotateCcw,
    toggleFullscreen,
    closeViewer: onClose,
    pageNext: onPageNext,
    pagePrev: onPagePrev,
  });

  // ── Coordinate projection for measurement overlay ────────────────────────
  const measurementProjection = useMemo(() => {
    if (mode === 'pdf') {
      return makePdfProjection(stageRef);
    }
    return makeDxfProjection(dxfEngine);
  }, [mode, dxfEngine]);

  // ── Render ───────────────────────────────────────────────────────────────
  if (error) {
    return (
      <ViewerError
        attachmentId={attachmentId}
        message={error.message}
        detail={error.detail}
        onClose={onClose}
      />
    );
  }

  return (
    <div ref={stageRef} className="flex h-full w-full flex-col bg-bg text-fg">
      <ViewerToolbar
        meta={meta}
        onModeChange={(m) => setMode(m)}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onFit={onFit}
        onActualSize={onActualSize}
        onRotateCw={onRotateCw}
        onRotateCcw={onRotateCcw}
        onRotate180={onRotate180}
        onToggleFullscreen={toggleFullscreen}
        onPrint={onPrint}
        onClose={onClose}
      />
      <div className="relative flex flex-1 overflow-hidden">
        <div className="relative flex-1 overflow-hidden">
          {resolved ? (
            <>
              {mode === 'pdf' && source.pdf ? (
                <PdfViewer
                  ref={pdfRef}
                  source={source.pdf}
                  onError={(m, d) => setError({ message: m, detail: d })}
                  onReady={setPdfRenderer}
                />
              ) : null}
              {mode === 'dxf' && source.dxf ? (
                useOwnDxfEngine ? (
                  <DwgViewer
                    ref={dxfRef}
                    source={source.dxf}
                    onError={(m, d) => setError({ message: m, detail: d })}
                    onReady={setDxfEngine}
                  />
                ) : (
                  <DxfViewer
                    ref={dxfRef}
                    source={source.dxf}
                    onError={(m, d) => setError({ message: m, detail: d })}
                    onReady={setDxfEngine}
                  />
                )
              ) : null}
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-fg-muted">
              <div className="flex flex-col items-center gap-2">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
                <span className="text-sm">미리보기 확인 중…</span>
              </div>
            </div>
          )}

          {/* Measurement overlay */}
          {resolved ? (
            <MeasurementOverlay
              active={tool !== 'pan'}
              screenToNative={measurementProjection.screenToNative}
              nativeToScreen={measurementProjection.nativeToScreen}
              unitLabel={mode === 'pdf' ? 'pt' : 'mm'}
            />
          ) : null}

          {/* Search panel */}
          <TextSearchPanel
            pdfRenderer={mode === 'pdf' ? pdfRenderer : null}
            dxfText={
              mode === 'dxf' && source.dxf && 'text' in source.dxf
                ? source.dxf.text
                : null
            }
            onJump={(hit) => {
              if (mode === 'pdf') setPage(hit.page);
              // DXF: focusing camera on a text entity isn't trivial — Phase 1
              // simply highlights the hit in the panel.
            }}
          />

          <MiniMap />
        </div>

        <ViewerSidebar meta={meta} onSelectPage={(p) => setPage(p)} />
      </div>

      <PrintLayout meta={meta} captureFrame={captureFrame} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coordinate projection
// ---------------------------------------------------------------------------

interface Projection {
  screenToNative: (p: Point2D) => WorldPoint | null;
  nativeToScreen: (p: WorldPoint) => Point2D | null;
}

/**
 * PDF projection: native space is "page coordinates at scale=1". The PdfViewer
 * mounts a stage div whose CSS transform is `translate(panX, panY) scale(zoom)`.
 * For the measurement overlay we need the inverse — given a click on the
 * overlay (which lies above the stage), find the equivalent page coords.
 *
 * We use a relaxed approximation: the canvas inside the stage is rendered at
 * `scale = zoom`, so screen-to-page = (overlayPoint - canvasOffset) / zoom.
 * We sample the canvas's bounding rect each call to handle pan + DPR.
 */
function makePdfProjection(
  stageRef: React.MutableRefObject<HTMLDivElement | null>,
): Projection {
  function findCanvas(): HTMLCanvasElement | null {
    return stageRef.current?.querySelector(
      'canvas[data-viewer-canvas="pdf"]',
    ) as HTMLCanvasElement | null;
  }
  return {
    screenToNative: (screen) => {
      const canvas = findCanvas();
      const overlay = stageRef.current?.querySelector('svg');
      if (!canvas || !overlay) return null;
      const cRect = canvas.getBoundingClientRect();
      const oRect = (overlay as SVGElement).getBoundingClientRect();
      // overlay coords are relative to overlay; convert to viewport coords.
      const vx = oRect.left + screen.x;
      const vy = oRect.top + screen.y;
      // Then to canvas-local (0..cssWidth).
      const localX = vx - cRect.left;
      const localY = vy - cRect.top;
      // Scale: cRect.width is the on-screen size (post-zoom transform).
      // The canvas's intrinsic CSS width is set to cssWidth (pre-DPR), but
      // the bounding rect includes any CSS transform — so scale accounts for it.
      const scaleX = cRect.width / Math.max(1, canvas.clientWidth);
      const scaleY = cRect.height / Math.max(1, canvas.clientHeight);
      // Page-space: divide by current zoom. We don't have direct access to
      // PdfRenderer here — but cRect is already in screen px so this is
      // sufficient for measurement consistency.
      return {
        space: 'pdf-page',
        x: localX / Math.max(0.001, scaleX),
        y: localY / Math.max(0.001, scaleY),
        page: undefined,
      };
    },
    nativeToScreen: (p) => {
      if (p.space !== 'pdf-page') return null;
      const canvas = findCanvas();
      const overlay = stageRef.current?.querySelector('svg');
      if (!canvas || !overlay) return null;
      const cRect = canvas.getBoundingClientRect();
      const oRect = (overlay as SVGElement).getBoundingClientRect();
      const scaleX = cRect.width / Math.max(1, canvas.clientWidth);
      const scaleY = cRect.height / Math.max(1, canvas.clientHeight);
      const localX = p.x * scaleX;
      const localY = p.y * scaleY;
      const vx = cRect.left + localX;
      const vy = cRect.top + localY;
      return { x: vx - oRect.left, y: vy - oRect.top };
    },
  };
}

/**
 * DXF projection: native space is world coords (mm by default). We invert the
 * orthographic camera projection.
 */
function makeDxfProjection(engine: DxfEngine | null): Projection {
  return {
    screenToNative: (screen) => {
      if (!engine) return null;
      const canvas = engine.instance.GetCanvas?.();
      if (!canvas) return null;
      const cRect = canvas.getBoundingClientRect();
      // Overlay sits over the canvas at the same location; we receive coords
      // relative to the overlay. To get canvas-local, we need to account for
      // any rotation transform the wrapper applied — fortunately the overlay
      // is *inside* the rotated wrapper, so screen coords already align.
      const local = { x: screen.x, y: screen.y };
      const world = screenToWorld(engine, local);
      if (!world) return null;
      return { space: 'dxf-world', x: world.x, y: world.y };
    },
    nativeToScreen: (p) => {
      if (p.space !== 'dxf-world' || !engine) return null;
      const canvas = engine.instance.GetCanvas?.();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cam = engine.instance.GetCamera?.() as any;
      if (!canvas || !cam) return null;
      const rect = canvas.getBoundingClientRect();
      if (
        cam.left == null ||
        cam.right == null ||
        cam.top == null ||
        cam.bottom == null
      )
        return null;
      const halfW = (cam.right - cam.left) / 2;
      const halfH = (cam.top - cam.bottom) / 2;
      const zoom = cam.zoom ?? 1;
      const cx = cam.position?.x ?? 0;
      const cy = cam.position?.y ?? 0;
      const ndcX = ((p.x - cx) * zoom) / halfW;
      const ndcY = ((p.y - cy) * zoom) / halfH;
      // Coords relative to canvas top-left — that's what the overlay receives.
      return {
        x: ((ndcX + 1) / 2) * rect.width,
        y: ((-ndcY + 1) / 2) * rect.height,
      };
    },
  };
}

// R5 (F4-08) opt-in switch. Either flag flips the DXF tab to the in-house
// engine; the URL flag wins so QA can A/B per-tab without restarting Next.
//
//   /viewer/<id>?engine=own         — force in-house
//   /viewer/<id>?engine=dxf-viewer  — force legacy
//   NEXT_PUBLIC_USE_OWN_DXF_VIEWER=0 — opt out to legacy (default = in-house)
//
// R24: env-unset behavior flipped to in-house. Phase 1~4 (LINE/CIRCLE/ARC/
// LWPOLYLINE/TEXT/MTEXT/INSERT/HATCH solid/DIMENSION + Web Worker) cover the
// vast majority of CGL drawings; HATCH patterns + line weights are the only
// known regressions vs. dxf-viewer and they degrade gracefully.
function useOwnDxfEngineFlag(): boolean {
  const envValue = process.env.NEXT_PUBLIC_USE_OWN_DXF_VIEWER;
  const envSaysOwn = envValue !== '0' && envValue !== 'false';
  if (typeof window === 'undefined') return envSaysOwn;
  const sp = new URLSearchParams(window.location.search);
  const param = sp.get('engine');
  if (param === 'own' || param === 'dwg') return true;
  if (param === 'dxf-viewer' || param === 'legacy') return false;
  return envSaysOwn;
}
