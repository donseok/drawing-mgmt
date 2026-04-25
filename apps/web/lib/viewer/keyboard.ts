/**
 * Viewer keyboard shortcuts (DESIGN §6.5).
 *
 *   +  /  =     zoom in
 *   -  /  _     zoom out
 *   0           fit to viewport
 *   1           actual size (100%)
 *   r           rotate 90° CW
 *   R (shift+r) rotate 90° CCW
 *   m           cycle measurement modes (off → distance → polyline → area → off)
 *   t           open / close text search
 *   l           toggle layers panel
 *   b           toggle background invert
 *   f           toggle fullscreen
 *   Esc         cancel active tool, close search if open, else close viewer
 *   ←  /  →     prev / next page (PDF) or pan canvas (DXF — handled by engine)
 *   Space (hold) temporary pan tool
 *
 * The handler ignores keystrokes from <input>, <textarea>, contenteditable,
 * and Radix-managed dialogs — so the search box, etc. don't trigger globals.
 */

'use client';

import { useEffect, useRef } from 'react';

import type { ToolMode } from './types';
import { useViewerStoreApi } from './use-viewer-state';

const MEASURE_CYCLE: ToolMode[] = [
  'measure-distance',
  'measure-polyline',
  'measure-area',
];

export interface ViewerKeyboardHandlers {
  /** Zoom in by 10%. */
  zoomIn: () => void;
  /** Zoom out by 10%. */
  zoomOut: () => void;
  /** Fit to viewport (engine-specific). */
  fit: () => void;
  /** Actual size (1.0). */
  actualSize: () => void;
  rotateCw: () => void;
  rotateCcw: () => void;
  toggleFullscreen: () => void;
  closeViewer: () => void;
  pageNext: () => void;
  pagePrev: () => void;
}

export function useViewerKeyboard(handlers: ViewerKeyboardHandlers): void {
  const storeApi = useViewerStoreApi();
  // Stash handlers in a ref so callers can pass a fresh object every render
  // without re-binding global listeners (we want listener reattach exactly
  // once per mount).
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const h = () => handlersRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreEvent(e)) return;
      const state = storeApi.getState();

      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault();
          h().zoomIn();
          return;
        case '-':
        case '_':
          e.preventDefault();
          h().zoomOut();
          return;
        case '0':
          e.preventDefault();
          h().fit();
          return;
        case '1':
          e.preventDefault();
          h().actualSize();
          return;
        case 'r':
          e.preventDefault();
          h().rotateCw();
          return;
        case 'R':
          e.preventDefault();
          h().rotateCcw();
          return;
        case 'm':
        case 'M':
          e.preventDefault();
          cycleMeasureTool(storeApi);
          return;
        case 't':
        case 'T':
          e.preventDefault();
          state.setSearchOpen(!state.searchOpen);
          return;
        case 'l':
        case 'L':
          e.preventDefault();
          state.setSidebarOpen(!state.sidebarOpen);
          if (!state.sidebarOpen) {
            state.setSidebarTab(state.mode === 'dxf' ? 'layers' : 'pages');
          }
          return;
        case 'b':
        case 'B':
          e.preventDefault();
          state.toggleInvert();
          return;
        case 'f':
        case 'F':
          e.preventDefault();
          h().toggleFullscreen();
          return;
        case 'Escape': {
          e.preventDefault();
          // Priority: cancel active measurement → close search → close viewer.
          if (state.tool !== 'pan') {
            state.setTool('pan');
            // Clear in-progress measurement (the overlay reads tool changes
            // and resets its draft; nothing else to do here).
            return;
          }
          if (state.searchOpen) {
            state.setSearchOpen(false);
            return;
          }
          h().closeViewer();
          return;
        }
        case 'ArrowLeft':
          if (state.mode === 'pdf') {
            e.preventDefault();
            h().pagePrev();
          }
          return;
        case 'ArrowRight':
          if (state.mode === 'pdf') {
            e.preventDefault();
            h().pageNext();
          }
          return;
        default:
          return;
      }
    };

    // Closure var: which tool to restore when Space is released.
    let prevToolForSpace: ToolMode | null = null;
    const onKeyDownPan = (e: KeyboardEvent) => {
      if (shouldIgnoreEvent(e)) return;
      if (e.key === ' ' || e.code === 'Space') {
        const state = storeApi.getState();
        if (state.tool !== 'pan' && prevToolForSpace === null) {
          prevToolForSpace = state.tool;
          state.setTool('pan');
        }
      }
    };
    const onKeyUpPan = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') {
        if (prevToolForSpace) {
          storeApi.getState().setTool(prevToolForSpace);
          prevToolForSpace = null;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onKeyDownPan);
    window.addEventListener('keyup', onKeyUpPan);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onKeyDownPan);
      window.removeEventListener('keyup', onKeyUpPan);
    };
    // handlers is read through the ref so we don't need it as a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeApi]);
}

function cycleMeasureTool(
  storeApi: ReturnType<typeof useViewerStoreApi>,
): void {
  const state = storeApi.getState();
  if (state.tool === 'pan') {
    state.setTool(MEASURE_CYCLE[0]!);
    return;
  }
  const idx = MEASURE_CYCLE.indexOf(state.tool);
  if (idx === -1 || idx === MEASURE_CYCLE.length - 1) {
    state.setTool('pan');
  } else {
    state.setTool(MEASURE_CYCLE[idx + 1]!);
  }
}

function shouldIgnoreEvent(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  // Modal-style overlays might mark their root with this attribute; defensive.
  if (target.closest('[data-viewer-ignore-keys="true"]')) return true;
  return false;
}
