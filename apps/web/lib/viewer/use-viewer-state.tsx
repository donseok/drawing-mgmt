/**
 * Zustand store for the viewer.
 *
 * Why Zustand and not React state? The viewer is deeply nested (toolbar, canvas,
 * sidebar, overlay, search panel) and many of these read/write the same
 * concerns (zoom, tool, layer visibility). Threading callbacks would be
 * brittle; a single store keeps interactions explicit and renders narrow.
 *
 * One store instance per mounted ViewerShell — we instantiate the store in
 * a context so multiple viewers (e.g. tabs, future split view) don't share
 * state.
 */

'use client';

import { createContext, useContext, useRef, type ReactNode } from 'react';
import { create, useStore, type StoreApi } from 'zustand';

import type {
  LayerInfo,
  Measurement,
  SidebarTab,
  ToolMode,
  ViewerMode,
} from './types';

export interface ViewerStoreState {
  // Mode + tools
  mode: ViewerMode;
  tool: ToolMode;
  // Display
  zoom: number; // 1 = 100%
  rotation: 0 | 90 | 180 | 270;
  invertBackground: boolean;
  showLineWeight: boolean;
  fullscreen: boolean;
  // PDF paging
  page: number;
  pageCount: number;
  // Sidebar
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  // DXF layers
  layers: LayerInfo[];
  // Measurements
  measurements: Measurement[];
  // Search
  searchQuery: string;
  searchOpen: boolean;
  searchHits: number;
  searchIndex: number;

  // Actions
  setMode: (mode: ViewerMode) => void;
  setTool: (tool: ToolMode) => void;
  setZoom: (zoom: number) => void;
  zoomBy: (factor: number) => void;
  setRotation: (rot: 0 | 90 | 180 | 270) => void;
  rotateBy: (deg: 90 | -90 | 180) => void;
  toggleInvert: () => void;
  toggleLineWeight: () => void;
  setFullscreen: (b: boolean) => void;
  setPage: (page: number) => void;
  setPageCount: (n: number) => void;
  setSidebarOpen: (b: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setLayers: (layers: LayerInfo[]) => void;
  toggleLayer: (name: string) => void;
  setAllLayers: (visible: boolean) => void;
  addMeasurement: (m: Measurement) => void;
  removeMeasurement: (id: string) => void;
  clearMeasurements: () => void;
  setSearchQuery: (q: string) => void;
  setSearchOpen: (b: boolean) => void;
  setSearchHits: (count: number) => void;
  setSearchIndex: (idx: number) => void;
  reset: () => void;
}

export interface ViewerStoreInit {
  initialMode?: ViewerMode;
}

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 32;

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

export function createViewerStore(
  init: ViewerStoreInit = {},
): StoreApi<ViewerStoreState> {
  return create<ViewerStoreState>()((set, get) => ({
    mode: init.initialMode ?? 'pdf',
    tool: 'pan',
    zoom: 1,
    rotation: 0,
    invertBackground: false,
    showLineWeight: true,
    fullscreen: false,
    page: 1,
    pageCount: 1,
    sidebarOpen: true,
    sidebarTab: 'pages',
    layers: [],
    measurements: [],
    searchQuery: '',
    searchOpen: false,
    searchHits: 0,
    searchIndex: 0,

    setMode: (mode) =>
      set({
        mode,
        // Sidebar tab follows the mode's natural default.
        sidebarTab: mode === 'dxf' ? 'layers' : 'pages',
      }),
    setTool: (tool) => set({ tool }),
    setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
    zoomBy: (factor) => set({ zoom: clampZoom(get().zoom * factor) }),
    setRotation: (rotation) => set({ rotation }),
    rotateBy: (deg) =>
      set((s) => {
        const next = ((s.rotation + deg + 360) % 360) as 0 | 90 | 180 | 270;
        return { rotation: next };
      }),
    toggleInvert: () => set((s) => ({ invertBackground: !s.invertBackground })),
    toggleLineWeight: () => set((s) => ({ showLineWeight: !s.showLineWeight })),
    setFullscreen: (fullscreen) => set({ fullscreen }),
    setPage: (page) =>
      set((s) => ({
        page: Math.max(1, Math.min(s.pageCount || 1, page)),
      })),
    setPageCount: (n) => set({ pageCount: Math.max(1, n) }),
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    setSidebarTab: (sidebarTab) => set({ sidebarTab }),
    setLayers: (layers) => set({ layers }),
    toggleLayer: (name) =>
      set((s) => ({
        layers: s.layers.map((l) =>
          l.name === name ? { ...l, visible: !l.visible } : l,
        ),
      })),
    setAllLayers: (visible) =>
      set((s) => ({
        layers: s.layers.map((l) => ({ ...l, visible })),
      })),
    addMeasurement: (m) =>
      set((s) => ({ measurements: [...s.measurements, m] })),
    removeMeasurement: (id) =>
      set((s) => ({
        measurements: s.measurements.filter((m) => m.id !== id),
      })),
    clearMeasurements: () => set({ measurements: [] }),
    setSearchQuery: (q) => set({ searchQuery: q }),
    setSearchOpen: (b) => set({ searchOpen: b }),
    setSearchHits: (count) => set({ searchHits: count }),
    setSearchIndex: (idx) => set({ searchIndex: idx }),
    reset: () =>
      set({
        zoom: 1,
        rotation: 0,
        page: 1,
        tool: 'pan',
        invertBackground: false,
      }),
  }));
}

const ViewerStoreContext = createContext<StoreApi<ViewerStoreState> | null>(
  null,
);

export function ViewerStoreProvider({
  children,
  init,
}: {
  children: ReactNode;
  init?: ViewerStoreInit;
}) {
  const ref = useRef<StoreApi<ViewerStoreState>>();
  if (!ref.current) {
    ref.current = createViewerStore(init);
  }
  return (
    <ViewerStoreContext.Provider value={ref.current}>
      {children}
    </ViewerStoreContext.Provider>
  );
}

/** Read a slice of the viewer store with referential stability. */
export function useViewerStore<T>(
  selector: (state: ViewerStoreState) => T,
): T {
  const store = useContext(ViewerStoreContext);
  if (!store)
    throw new Error('useViewerStore must be used inside ViewerStoreProvider');
  return useStore(store, selector);
}

/** Access the raw store (e.g. for getState() inside event handlers). */
export function useViewerStoreApi(): StoreApi<ViewerStoreState> {
  const store = useContext(ViewerStoreContext);
  if (!store)
    throw new Error(
      'useViewerStoreApi must be used inside ViewerStoreProvider',
    );
  return store;
}
