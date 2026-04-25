'use client';

/**
 * DxfViewer — mounts dxf-viewer inside a container div.
 *
 * dxf-viewer manages its own canvas + camera. We hand it a div, call Load(url),
 * then expose imperative actions (zoomIn/Out/fit/rotate via internal camera
 * mutation where possible).
 *
 * Quirks worth knowing:
 *  - `dxf-viewer` doesn't expose a public `setRotation()` — we rotate by
 *    rotating the camera's `up` vector (a hack, but it works for the limited
 *    90° rotations the UI offers).
 *  - `Load()` requires a same-origin URL. For our sample fixture (an inline
 *    string), we synthesize a Blob URL.
 *  - The library auto-resizes when `autoResize: true`, so we don't need a
 *    ResizeObserver.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import { cn } from '@/lib/cn';
import { createDxfEngine, type DxfEngine } from '@/lib/viewer/dxf-engine';
import { useViewerStore, useViewerStoreApi } from '@/lib/viewer/use-viewer-state';

export interface DxfViewerHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  actualSize: () => void;
  rotateCw: () => void;
  rotateCcw: () => void;
  rotate180: () => void;
  /** Get a PNG of the current canvas (for Print). */
  getCurrentImageDataUrl: () => string | null;
  getEngine: () => DxfEngine | null;
}

export interface DxfViewerProps {
  /** URL the engine will fetch, OR raw text to be wrapped in a Blob URL. */
  source: { url: string } | { text: string };
  onError: (msg: string, detail?: string) => void;
  onReady: (engine: DxfEngine) => void;
}

const DXF_ZOOM_STEP = 1.2;

export const DxfViewer = forwardRef<DxfViewerHandle, DxfViewerProps>(
  function DxfViewer({ source, onError, onReady }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<DxfEngine | null>(null);
    const blobUrlRef = useRef<string | null>(null);

    const storeApi = useViewerStoreApi();
    const setLayers = useViewerStore((s) => s.setLayers);
    const layers = useViewerStore((s) => s.layers);
    const invert = useViewerStore((s) => s.invertBackground);

    // Sync layer visibility from the store back into dxf-viewer.
    useEffect(() => {
      const engine = engineRef.current;
      if (!engine) return;
      for (const l of layers) {
        engine.setLayerVisibility(l.name, l.visible);
      }
    }, [layers]);

    // Initialize once.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let cancelled = false;

      (async () => {
        try {
          const engine = await createDxfEngine(container);
          if (cancelled) {
            engine.destroy();
            return;
          }
          engineRef.current = engine;

          let url: string;
          if ('url' in source) {
            url = source.url;
          } else {
            const blob = new Blob([source.text], { type: 'application/dxf' });
            url = URL.createObjectURL(blob);
            blobUrlRef.current = url;
          }

          await engine.load(url);

          // Surface layers to the store so the sidebar can render them.
          const layerList = engine.getLayers();
          setLayers(layerList);

          onReady(engine);
        } catch (err) {
          const e = err as Error;
          onError('DXF 파일을 열 수 없습니다.', e.message);
        }
      })();

      return () => {
        cancelled = true;
        try {
          engineRef.current?.destroy();
        } catch {
          /* ignore */
        }
        engineRef.current = null;
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, ['url' in source ? source.url : source.text]);

    // Camera helpers — best-effort because dxf-viewer's camera API isn't fully
    // public. We mutate the camera object in place (it's a three.js Orthographic).
    const mutateCamera = useCallback(
      (mutator: (cam: { zoom?: number; up?: { set?: (x: number, y: number, z: number) => void }; updateProjectionMatrix?: () => void }) => void) => {
        const eng = engineRef.current;
        if (!eng) return;
        const cam = eng.instance.GetCamera?.() as
          | (object & {
              zoom?: number;
              up?: { set?: (x: number, y: number, z: number) => void };
              updateProjectionMatrix?: () => void;
            })
          | undefined;
        if (!cam) return;
        mutator(cam);
        cam.updateProjectionMatrix?.();
        // Some renderers need a second render call; trigger via the renderer if available.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const renderer = (eng.instance.GetRenderer?.() as any) ?? null;
        if (renderer && cam && eng.instance.GetScene) {
          try {
            renderer.render(eng.instance.GetScene(), cam);
          } catch {
            /* ignore */
          }
        }
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => {
          mutateCamera((cam) => {
            cam.zoom = Math.min(32, (cam.zoom ?? 1) * DXF_ZOOM_STEP);
          });
          storeApi.getState().zoomBy(DXF_ZOOM_STEP);
        },
        zoomOut: () => {
          mutateCamera((cam) => {
            cam.zoom = Math.max(0.05, (cam.zoom ?? 1) / DXF_ZOOM_STEP);
          });
          storeApi.getState().zoomBy(1 / DXF_ZOOM_STEP);
        },
        fit: () => {
          engineRef.current?.fit();
          storeApi.getState().setZoom(1);
        },
        actualSize: () => {
          mutateCamera((cam) => {
            cam.zoom = 1;
          });
          storeApi.getState().setZoom(1);
        },
        rotateCw: () => storeApi.getState().rotateBy(90),
        rotateCcw: () => storeApi.getState().rotateBy(-90),
        rotate180: () => storeApi.getState().rotateBy(180),
        getCurrentImageDataUrl: () => {
          const canvas = engineRef.current?.instance.GetCanvas?.();
          if (!canvas) return null;
          try {
            return canvas.toDataURL('image/png');
          } catch {
            return null;
          }
        },
        getEngine: () => engineRef.current,
      }),
      [mutateCamera, storeApi],
    );

    // Apply rotation via CSS on the wrapper. dxf-viewer manages its own canvas
    // sizing so we rotate the *container*, not the canvas.
    const rotation = useViewerStore((s) => s.rotation);

    return (
      <div
        ref={containerRef}
        className={cn('relative h-full w-full overflow-hidden bg-white')}
        style={{
          transform: rotation === 0 ? undefined : `rotate(${rotation}deg)`,
          transformOrigin: 'center center',
          filter: invert ? 'invert(1) hue-rotate(180deg)' : undefined,
        }}
        data-viewer-canvas="dxf"
      />
    );
  },
);
