// 2D viewport controller — OrthographicCamera + pan/zoom event glue.
//
// Why not OrbitControls: OrbitControls adds rotation we don't want, polls
// per frame even when idle, and pulls examples/jsm into our bundle. A 130-line
// dedicated controller stays cheaper to ship and easier to extend (e.g. tying
// pinch-zoom or a marquee select in later phases).
//
// The controller never auto-renders; callers pass a `requestRender()` callback
// they invoke each frame. That keeps the React layer in charge of rAF
// scheduling so we can pause when the viewer tab loses focus.

import * as THREE from 'three';

import type { V2 } from '@/lib/dxf-parser';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;
const WHEEL_ZOOM_FACTOR = 1.0015; // multiplied by deltaY; gentle gradient

export interface CameraController {
  camera: THREE.OrthographicCamera;
  /** Recompute frustum + zoom from a viewport size. Call on resize. */
  resize: (widthPx: number, heightPx: number) => void;
  /** Center the camera on `bounds` and pick a zoom that fits with a margin. */
  fit: (bounds: { min: V2; max: V2 }, marginPx?: number) => void;
  /** Multiplicative zoom (>1 zooms in). Pivots around the viewport center. */
  zoomBy: (factor: number) => void;
  /** Set absolute zoom. */
  setZoom: (zoom: number) => void;
  /** Add pan + wheel listeners to a DOM element. Returns an unbind. */
  attach: (
    el: HTMLElement,
    requestRender: () => void,
  ) => () => void;
  dispose: () => void;
}

export function createCameraController(
  initialWidth: number,
  initialHeight: number,
): CameraController {
  // Frustum starts as a unit square; resize() picks the real numbers below.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
  camera.position.set(0, 0, 100);
  camera.zoom = 1;
  camera.updateProjectionMatrix();

  let viewportW = initialWidth;
  let viewportH = initialHeight;

  const resize = (w: number, h: number) => {
    viewportW = Math.max(1, w);
    viewportH = Math.max(1, h);
    // The frustum half-widths track the viewport so 1 world unit = 1 CSS
    // pixel at zoom=1. Subsequent fit() calls override zoom but keep the
    // aspect-correct frustum sides.
    camera.left = -viewportW / 2;
    camera.right = viewportW / 2;
    camera.top = viewportH / 2;
    camera.bottom = -viewportH / 2;
    camera.updateProjectionMatrix();
  };
  resize(initialWidth, initialHeight);

  const fit = (bounds: { min: V2; max: V2 }, marginPx = 24) => {
    const w = Math.max(1e-6, bounds.max.x - bounds.min.x);
    const h = Math.max(1e-6, bounds.max.y - bounds.min.y);
    const cx = (bounds.min.x + bounds.max.x) / 2;
    const cy = (bounds.min.y + bounds.max.y) / 2;
    camera.position.set(cx, cy, 100);
    // Choose zoom so both axes fit inside (viewport - 2*margin).
    const usableW = Math.max(1, viewportW - marginPx * 2);
    const usableH = Math.max(1, viewportH - marginPx * 2);
    const zoom = Math.min(usableW / w, usableH / h);
    camera.zoom = clampZoom(zoom);
    camera.updateProjectionMatrix();
  };

  const zoomBy = (factor: number) => {
    camera.zoom = clampZoom(camera.zoom * factor);
    camera.updateProjectionMatrix();
  };

  const setZoom = (z: number) => {
    camera.zoom = clampZoom(z);
    camera.updateProjectionMatrix();
  };

  // ── Event handlers (built once per attach() call so they can be removed) ─
  const attach = (el: HTMLElement, requestRender: () => void): (() => void) => {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      // Middle-mouse OR primary-button-with-no-modifier counts as pan; this
      // leaves left-click free for a future selection tool.
      const isPan =
        e.button === 1 ||
        (e.button === 0 && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey);
      if (!isPan) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      // Convert pixel delta → world delta. zoom = world units shown per
      // viewport pixel⁻¹, so 1 px ≈ 1/zoom world units.
      camera.position.x -= dx / camera.zoom;
      camera.position.y += dy / camera.zoom; // Y inverted: screen-Y points down
      requestRender();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      el.style.cursor = '';
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Anchor the zoom on the cursor: convert cursor position to world,
      // change zoom, then nudge the camera so that world point still lands
      // under the cursor.
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = rect.height / 2 - (e.clientY - rect.top);
      const worldX = camera.position.x + cx / camera.zoom;
      const worldY = camera.position.y + cy / camera.zoom;

      const factor = Math.pow(WHEEL_ZOOM_FACTOR, -e.deltaY);
      const nextZoom = clampZoom(camera.zoom * factor);
      camera.zoom = nextZoom;
      camera.position.x = worldX - cx / nextZoom;
      camera.position.y = worldY - cy / nextZoom;
      camera.updateProjectionMatrix();
      requestRender();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
    };
  };

  return {
    camera,
    resize,
    fit,
    zoomBy,
    setZoom,
    attach,
    dispose: () => {
      // OrthographicCamera owns no GPU resources; nothing to release.
    },
  };
}

function clampZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}
