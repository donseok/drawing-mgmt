/**
 * dxf-viewer engine wrapper.
 *
 * `dxf-viewer` (npm package, MIT) renders DXF on top of three.js. It mounts
 * itself into a DOM container and exposes a small JS API. We wrap it here
 * so the React component stays presentational.
 *
 * Key APIs (per dxf-viewer README; minor version differences exist — we use
 * defensive feature-detection):
 *   new DxfViewer(container, options)
 *   .Load({ url, fonts, workerFactory? })   → Promise<void>
 *   .GetLayers() → Map<string, { name, color, displayName, frozen, ... }>
 *   .ShowLayer(name, visible)
 *   .GetCanvas() → HTMLCanvasElement
 *   .GetScene() → THREE.Scene
 *   .GetCamera() → THREE.OrthographicCamera
 *   .Subscribe('viewChanged', cb)
 *   .Destroy()
 *   .GetOriginalDxf() (optional, depending on version)
 *
 * Lazy-loaded so three.js + dxf-viewer (~1MB combined) only ship when this
 * route mounts.
 */

'use client';

import type { LayerInfo } from './types';

// We avoid a top-level `import` of 'dxf-viewer' (it pulls in three.js eagerly).
// Instead, use a typed dynamic import.
type DxfViewerCtor = new (
  container: HTMLElement,
  options?: Record<string, unknown>,
) => DxfViewerInstance;

export interface DxfViewerInstance {
  Load: (opts: {
    url: string;
    fonts?: string[];
    workerFactory?: () => Worker;
  }) => Promise<void>;
  GetLayers: () => Map<
    string,
    {
      name: string;
      displayName?: string;
      color?: number;
      frozen?: boolean;
    }
  > | Array<{
    name: string;
    displayName?: string;
    color?: number;
    frozen?: boolean;
  }>;
  ShowLayer: (name: string, visible: boolean) => void;
  GetCanvas: () => HTMLCanvasElement;
  GetScene?: () => unknown;
  GetCamera?: () => unknown;
  GetRenderer?: () => unknown;
  Subscribe?: (event: string, cb: (...args: unknown[]) => void) => void;
  Unsubscribe?: (event: string, cb: (...args: unknown[]) => void) => void;
  Destroy: () => void;
  /** Some versions expose a fit() / FitView(); detect at call time. */
  FitView?: () => void;
  Fit?: () => void;
}

let modulePromise: Promise<DxfViewerCtor> | null = null;

async function loadDxfViewerCtor(): Promise<DxfViewerCtor> {
  if (!modulePromise) {
    modulePromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('dxf-viewer');
      // The package exports `DxfViewer` as a named export in v1.1+; older
      // versions used a default export. Pick whichever exists.
      const Ctor: DxfViewerCtor = mod.DxfViewer ?? mod.default ?? mod;
      if (!Ctor) {
        throw new Error('Could not locate DxfViewer constructor');
      }
      return Ctor;
    })();
  }
  return modulePromise;
}

export interface DxfEngineOptions {
  /** Canvas background. Default: white (DESIGN — viewer canvas stays white). */
  clearColor?: number;
  /** Auto-resize when the container resizes. */
  autoResize?: boolean;
}

/**
 * Create and initialize a dxf-viewer instance bound to `container`.
 * Returns a thin facade with only the methods the UI actually calls.
 */
export interface DxfEngine {
  instance: DxfViewerInstance;
  load: (url: string) => Promise<void>;
  getLayers: () => LayerInfo[];
  setLayerVisibility: (name: string, visible: boolean) => void;
  /** Best-effort fit-to-view; falls back to a no-op when unsupported. */
  fit: () => void;
  /** Subscribe to view (camera) changes; returns an unsubscribe function. */
  onViewChange: (cb: () => void) => () => void;
  destroy: () => void;
}

export async function createDxfEngine(
  container: HTMLElement,
  options: DxfEngineOptions = {},
): Promise<DxfEngine> {
  const Ctor = await loadDxfViewerCtor();
  const instance = new Ctor(container, {
    clearColor: options.clearColor ?? 0xffffff,
    autoResize: options.autoResize ?? true,
    canvasAlpha: false,
    pointSize: 2,
  });

  const subs: Array<() => void> = [];

  return {
    instance,
    async load(url: string) {
      await instance.Load({ url, fonts: [] });
    },
    getLayers() {
      const raw = instance.GetLayers?.();
      if (!raw) return [];
      const list: LayerInfo[] = [];
      const push = (l: {
        name: string;
        displayName?: string;
        color?: number;
        frozen?: boolean;
      }) => {
        list.push({
          name: l.name,
          displayName: l.displayName ?? l.name,
          color: l.color,
          colorHex: l.color != null ? toHexColor(l.color) : undefined,
          frozen: !!l.frozen,
          visible: true,
        });
      };
      if (raw instanceof Map) {
        for (const layer of raw.values()) push(layer);
      } else if (Array.isArray(raw)) {
        for (const layer of raw) push(layer);
      }
      return list;
    },
    setLayerVisibility(name, visible) {
      try {
        instance.ShowLayer(name, visible);
      } catch {
        // ignore — older versions are flaky around layer toggles
      }
    },
    fit() {
      const fitFn = instance.FitView ?? instance.Fit;
      try {
        fitFn?.call(instance);
      } catch {
        /* no-op */
      }
    },
    onViewChange(cb) {
      // dxf-viewer fires 'viewChanged' on camera moves in v1.1+. Best effort:
      // if not available, fall back to listening to wheel/mousemove on canvas.
      const sub = instance.Subscribe;
      const unsub = instance.Unsubscribe;
      if (sub && unsub) {
        const handler = () => cb();
        sub.call(instance, 'viewChanged', handler);
        const off = () => unsub.call(instance, 'viewChanged', handler);
        subs.push(off);
        return off;
      }
      // Fallback: pointer/wheel events on canvas trigger redraws → repoll on idle.
      const canvas = instance.GetCanvas?.();
      if (!canvas) return () => undefined;
      const handler = () => cb();
      canvas.addEventListener('wheel', handler, { passive: true });
      canvas.addEventListener('pointerup', handler);
      const off = () => {
        canvas.removeEventListener('wheel', handler);
        canvas.removeEventListener('pointerup', handler);
      };
      subs.push(off);
      return off;
    },
    destroy() {
      for (const off of subs) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
      subs.length = 0;
      try {
        instance.Destroy();
      } catch {
        /* ignore */
      }
    },
  };
}

/** AutoCAD true color int → CSS hex string (#RRGGBB). */
function toHexColor(value: number): string {
  // Some versions encode color as packed RGB int; older use AutoCAD ACI index.
  // ACI uses 0-255 indices that aren't directly RGB — but for display we just
  // need *something* recognizable, so we treat values < 256 as ACI indices and
  // map a tiny palette. Otherwise treat as 0xRRGGBB.
  if (value >= 0 && value <= 255 && Number.isInteger(value)) {
    return ACI_HEX[value] ?? '#888888';
  }
  const v = value & 0xffffff;
  return '#' + v.toString(16).padStart(6, '0');
}

/** AutoCAD Color Index (ACI) → hex. Only the common indices; rest fall back. */
const ACI_HEX: Record<number, string> = {
  0: '#000000', // ByBlock
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  7: '#ffffff',
  8: '#808080',
  9: '#c0c0c0',
  256: '#888888', // ByLayer
};

/**
 * Convert screen (CSS px relative to the canvas) into world coordinates by
 * inverse-projecting through the camera. Used by the measurement overlay.
 *
 * Returns null when projection is unavailable (e.g. before load).
 */
export function screenToWorld(
  engine: DxfEngine,
  screen: { x: number; y: number },
): { x: number; y: number } | null {
  const camAny = engine.instance.GetCamera?.() as
    | {
        left?: number;
        right?: number;
        top?: number;
        bottom?: number;
        position?: { x: number; y: number };
        zoom?: number;
      }
    | undefined;
  const canvas = engine.instance.GetCanvas?.();
  if (!camAny || !canvas) return null;

  const rect = canvas.getBoundingClientRect();
  // Normalized device coords [-1, 1].
  const ndcX = (screen.x / rect.width) * 2 - 1;
  const ndcY = -((screen.y / rect.height) * 2 - 1);

  if (
    camAny.left == null ||
    camAny.right == null ||
    camAny.top == null ||
    camAny.bottom == null
  ) {
    return null;
  }

  // Orthographic inverse projection.
  const halfW = (camAny.right - camAny.left) / 2;
  const halfH = (camAny.top - camAny.bottom) / 2;
  const zoom = camAny.zoom ?? 1;
  const cx = camAny.position?.x ?? 0;
  const cy = camAny.position?.y ?? 0;
  return {
    x: cx + (ndcX * halfW) / zoom,
    y: cy + (ndcY * halfH) / zoom,
  };
}
