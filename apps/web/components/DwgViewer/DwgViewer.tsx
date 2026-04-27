'use client';

/**
 * DwgViewer — in-house DXF viewer (R5 Phase 1).
 *
 * Pipeline:
 *   1. Resolve source → DXF text (fetch URL or use inline text)
 *   2. parseDxf() → entity tree
 *   3. buildScene() → THREE.Scene with one geometry per (layer × kind)
 *   4. WebGLRenderer + OrthographicCamera; pan/zoom via createCameraController
 *
 * Why a separate component (vs. patching DxfViewer): keeping the dxf-viewer
 * codepath intact lets us A/B the two engines via ViewerShell prop without
 * regressing users who depend on dxf-viewer's hatch/text/insert support
 * (which Phase 1 doesn't cover yet).
 *
 * Public surface mirrors DxfViewerHandle deliberately so ViewerToolbar /
 * MeasurementOverlay can stay engine-agnostic.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import { cn } from '@/lib/cn';
import type { DxfDocument } from '@/lib/dxf-parser';
import {
  useViewerStore,
  useViewerStoreApi,
} from '@/lib/viewer/use-viewer-state';
import type { DxfEngine, DxfViewerInstance } from '@/lib/viewer/dxf-engine';
import type { LayerInfo } from '@/lib/viewer/types';

import { buildScene, type BuiltScene } from './scene';
import { createCameraController, type CameraController } from './camera';
import { parseDxfAsync } from './dxf-worker-client';

const ZOOM_STEP = 1.2;

export interface DwgViewerHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  actualSize: () => void;
  rotateCw: () => void;
  rotateCcw: () => void;
  rotate180: () => void;
  getCurrentImageDataUrl: () => string | null;
  /** DxfEngine facade for screenToWorld + measurement overlay compatibility. */
  getEngine: () => DxfEngine | null;
}

export interface DwgViewerProps {
  source: { url: string } | { text: string };
  onError: (msg: string, detail?: string) => void;
  onReady: (engine: DxfEngine) => void;
}

export const DwgViewer = forwardRef<DwgViewerHandle, DwgViewerProps>(
  function DwgViewer({ source, onError, onReady }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<import('three').WebGLRenderer | null>(null);
    const sceneRef = useRef<BuiltScene | null>(null);
    const cameraRef = useRef<CameraController | null>(null);
    const engineFacadeRef = useRef<DxfEngine | null>(null);
    const docRef = useRef<DxfDocument | null>(null);
    const layerVisibilityCallbacksRef = useRef<Set<() => void>>(new Set());
    const renderRequestedRef = useRef(false);

    const storeApi = useViewerStoreApi();
    const setLayers = useViewerStore((s) => s.setLayers);
    const layers = useViewerStore((s) => s.layers);
    const invert = useViewerStore((s) => s.invertBackground);

    // Sync layer toggles from the store back into the scene groups. Mirrors
    // the dxf-viewer integration in DxfViewer.tsx so the layer panel works
    // identically across engines.
    useEffect(() => {
      const built = sceneRef.current;
      if (!built) return;
      for (const l of layers) {
        const sceneLayer = built.layers.find((sl) => sl.name === l.name);
        if (sceneLayer) sceneLayer.group.visible = l.visible;
      }
      requestRender();
      // requestRender is stable — defined below in module scope of the
      // component instance, captured by closure.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [layers]);

    const requestRender = useCallback(() => {
      if (renderRequestedRef.current) return;
      renderRequestedRef.current = true;
      requestAnimationFrame(() => {
        renderRequestedRef.current = false;
        const renderer = rendererRef.current;
        const built = sceneRef.current;
        const cam = cameraRef.current;
        if (!renderer || !built || !cam) return;
        renderer.render(built.scene, cam.camera);
      });
    }, []);

    // Initialize once per source change.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let cancelled = false;
      const cleanups: Array<() => void> = [];

      (async () => {
        try {
          // 1. Resolve to DXF text.
          let text: string;
          if ('text' in source) {
            text = source.text;
          } else {
            const res = await fetch(source.url, { credentials: 'include' });
            if (!res.ok) {
              throw new Error(`DXF 다운로드 실패 (${res.status})`);
            }
            text = await res.text();
          }
          if (cancelled) return;

          // 2. Parse — runs in a Web Worker when supported (R13), falls back
          //    to synchronous on this thread otherwise. Either way the
          //    `await` keeps the caller's loading UI in charge.
          const doc = await parseDxfAsync(text);
          if (cancelled) return;
          if (doc.unsupportedKinds.length > 0) {
            // eslint-disable-next-line no-console
            console.info(
              '[DwgViewer] unsupported entity kinds:',
              doc.unsupportedKinds.join(', '),
            );
          }
          docRef.current = doc;

          // 3. Build scene.
          const built = buildScene(doc);
          sceneRef.current = built;

          // 4. Renderer + camera.
          const THREE = await import('three');
          const rect = container.getBoundingClientRect();
          const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
          });
          renderer.setPixelRatio(window.devicePixelRatio);
          renderer.setSize(rect.width, rect.height, false);
          renderer.setClearColor(0xffffff, 1);
          container.appendChild(renderer.domElement);
          // Block native browser gestures so wheel zoom + pan don't fight.
          renderer.domElement.style.touchAction = 'none';
          renderer.domElement.style.display = 'block';
          renderer.domElement.style.width = '100%';
          renderer.domElement.style.height = '100%';
          rendererRef.current = renderer;

          const cam = createCameraController(rect.width, rect.height);
          cameraRef.current = cam;
          cam.fit(doc.bounds);

          const detachCam = cam.attach(renderer.domElement, requestRender);
          cleanups.push(detachCam);

          // R37 V-2 — push the initial canvas size into every Line2 material
          // so the screen-space wide-line shader has a non-default resolution
          // before the first frame. Subsequent updates flow through the
          // ResizeObserver below.
          built.setResolution(rect.width, rect.height);

          // ResizeObserver keeps the renderer + camera frustum in sync when
          // the container changes size (sidebar collapse, fullscreen, etc.).
          const ro = new ResizeObserver(() => {
            const r = container.getBoundingClientRect();
            renderer.setSize(r.width, r.height, false);
            cam.resize(r.width, r.height);
            // Resolution is the only LineMaterial uniform that depends on
            // viewport size; updating it here keeps wide-line widths stable
            // across sidebar collapses, fullscreen toggles, etc.
            built.setResolution(r.width, r.height);
            requestRender();
          });
          ro.observe(container);
          cleanups.push(() => ro.disconnect());

          // 5. Surface layer list to the store so the sidebar renders.
          const layerList: LayerInfo[] = built.layers.map((sl) => ({
            name: sl.name,
            displayName: sl.name,
            color: sl.color,
            colorHex: '#' + sl.color.toString(16).padStart(6, '0'),
            visible: sl.initiallyVisible,
            frozen: !sl.initiallyVisible,
          }));
          setLayers(layerList);

          // 6. Build the DxfEngine facade so existing consumers
          //    (MeasurementOverlay → screenToWorld) keep working.
          const facade = makeEngineFacade({
            canvas: renderer.domElement,
            camera: cam.camera,
            scene: built.scene,
            renderer,
            getLayers: () => layerList,
            setLayerVisibility: (name, visible) => {
              const sceneLayer = built.layers.find((sl) => sl.name === name);
              if (sceneLayer) sceneLayer.group.visible = visible;
              for (const cb of layerVisibilityCallbacksRef.current) cb();
              requestRender();
            },
            fit: () => {
              cam.fit(doc.bounds);
              requestRender();
            },
            onViewChange: (cb) => {
              layerVisibilityCallbacksRef.current.add(cb);
              return () => {
                layerVisibilityCallbacksRef.current.delete(cb);
              };
            },
            destroy: () => {
              // No-op: lifecycle is owned by the React unmount handler below.
            },
          });
          engineFacadeRef.current = facade;

          requestRender();
          onReady(facade);
        } catch (err) {
          const e = err as Error;
          onError('DXF 파일을 열 수 없습니다.', e.message);
        }
      })();

      return () => {
        cancelled = true;
        for (const fn of cleanups) {
          try {
            fn();
          } catch {
            /* ignore */
          }
        }
        cleanups.length = 0;
        sceneRef.current?.dispose();
        sceneRef.current = null;
        const renderer = rendererRef.current;
        if (renderer) {
          renderer.dispose();
          if (renderer.domElement.parentElement) {
            renderer.domElement.parentElement.removeChild(renderer.domElement);
          }
        }
        rendererRef.current = null;
        cameraRef.current?.dispose();
        cameraRef.current = null;
        engineFacadeRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, ['url' in source ? source.url : source.text]);

    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => {
          cameraRef.current?.zoomBy(ZOOM_STEP);
          storeApi.getState().zoomBy(ZOOM_STEP);
          requestRender();
        },
        zoomOut: () => {
          cameraRef.current?.zoomBy(1 / ZOOM_STEP);
          storeApi.getState().zoomBy(1 / ZOOM_STEP);
          requestRender();
        },
        fit: () => {
          const doc = docRef.current;
          if (cameraRef.current && doc) {
            cameraRef.current.fit(doc.bounds);
            requestRender();
          }
          storeApi.getState().setZoom(1);
        },
        actualSize: () => {
          cameraRef.current?.setZoom(1);
          storeApi.getState().setZoom(1);
          requestRender();
        },
        rotateCw: () => storeApi.getState().rotateBy(90),
        rotateCcw: () => storeApi.getState().rotateBy(-90),
        rotate180: () => storeApi.getState().rotateBy(180),
        getCurrentImageDataUrl: () => {
          const renderer = rendererRef.current;
          if (!renderer) return null;
          try {
            return renderer.domElement.toDataURL('image/png');
          } catch {
            return null;
          }
        },
        getEngine: () => engineFacadeRef.current,
      }),
      [requestRender, storeApi],
    );

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
        data-viewer-canvas="dwg"
      />
    );
  },
);

// ── Engine facade ─────────────────────────────────────────────────────────
//
// `MeasurementOverlay` and other call sites read `engine.instance.GetCanvas()`
// / `GetCamera()` / `GetScene()` / `GetRenderer()` directly. We satisfy those
// methods so the consumer code can stay engine-agnostic.

function makeEngineFacade(opts: {
  canvas: HTMLCanvasElement;
  camera: import('three').OrthographicCamera;
  scene: import('three').Scene;
  renderer: import('three').WebGLRenderer;
  getLayers: () => LayerInfo[];
  setLayerVisibility: (name: string, visible: boolean) => void;
  fit: () => void;
  onViewChange: (cb: () => void) => () => void;
  destroy: () => void;
}): DxfEngine {
  // Cast through `unknown` because the underlying dxf-viewer's
  // `DxfViewerInstance` is the real shape and we only mimic the method
  // surface MeasurementOverlay actually calls.
  const instance: DxfViewerInstance = {
    Load: async () => undefined,
    GetLayers: () => new Map(),
    ShowLayer: opts.setLayerVisibility,
    GetCanvas: () => opts.canvas,
    GetCamera: () => opts.camera,
    GetScene: () => opts.scene,
    GetRenderer: () => opts.renderer,
    Subscribe: undefined,
    Unsubscribe: undefined,
    Destroy: () => undefined,
    FitView: opts.fit,
  } as unknown as DxfViewerInstance;

  return {
    instance,
    load: async () => undefined,
    getLayers: opts.getLayers,
    setLayerVisibility: opts.setLayerVisibility,
    fit: opts.fit,
    onViewChange: opts.onViewChange,
    destroy: opts.destroy,
  };
}
