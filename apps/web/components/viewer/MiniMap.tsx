'use client';

/**
 * MiniMap — small navigator showing the current viewport over the full drawing.
 *
 * Stub implementation: renders a 160×120 placeholder card with the current
 * zoom and rotation values. A future iteration will draw a real thumbnail of
 * the page (PDF.js page render at low scale) or DXF extents box, with a
 * draggable viewport rectangle.
 *
 * Kept tiny so the parent layout reserves the corner without committing to
 * features we haven't wired yet.
 */

import { useViewerStore } from '@/lib/viewer/use-viewer-state';

export function MiniMap() {
  const zoom = useViewerStore((s) => s.zoom);
  const rotation = useViewerStore((s) => s.rotation);

  return (
    <div
      className="pointer-events-none absolute bottom-3 right-3 hidden h-24 w-32 select-none flex-col items-center justify-center rounded border border-border bg-bg/90 text-[11px] text-fg-muted shadow-sm backdrop-blur-sm md:flex"
      aria-hidden
    >
      <span>미니맵 (예정)</span>
      <span className="font-mono">
        {Math.round(zoom * 100)}% / {rotation}°
      </span>
    </div>
  );
}
