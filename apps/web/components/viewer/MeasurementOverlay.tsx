'use client';

/**
 * MeasurementOverlay — SVG drawn on top of the canvas that captures clicks
 * for the active measurement tool.
 *
 * Coordinate spaces:
 *  - Pointer events arrive in **screen** coords (relative to overlay).
 *  - We convert to **native** coords (PDF page units OR DXF world units) so
 *    that zoom/pan don't invalidate persisted measurements.
 *  - For rendering, we convert each persisted point back to screen on every
 *    frame (cheap; the count is tiny — usually <10 measurements visible).
 *
 * Tool flow:
 *  - distance:   click p1, click p2, value rendered, returns to ready state
 *  - polyline:   click points; ESC or Enter completes
 *  - area:       click points; double-click or ESC completes (≥3 required)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  centroid,
  distance,
  formatArea,
  formatLength,
  midpoint,
  polygonArea,
  polygonPerimeter,
  polylineLength,
} from '@/lib/viewer/measurements';
import type {
  Measurement,
  MeasurementKind,
  Point2D,
  ToolMode,
  WorldPoint,
} from '@/lib/viewer/types';
import { useViewerStore } from '@/lib/viewer/use-viewer-state';

export interface MeasurementOverlayProps {
  /** Convert screen coords (relative to overlay) to native space. */
  screenToNative: (p: Point2D) => WorldPoint | null;
  /** Convert native space back to screen coords for rendering. */
  nativeToScreen: (p: WorldPoint) => Point2D | null;
  /** Display unit for length (e.g. "mm", "pt"). */
  unitLabel?: string;
  /**
   * If true, the overlay swallows pointer events (when a measure tool is
   * active). When false, clicks pass through to the canvas (pan).
   */
  active: boolean;
}

const TOOL_TO_KIND: Record<ToolMode, MeasurementKind | null> = {
  pan: null,
  'measure-distance': 'distance',
  'measure-polyline': 'polyline',
  'measure-area': 'area',
};

let _idCounter = 0;
function newId(): string {
  _idCounter += 1;
  return `m-${Date.now().toString(36)}-${_idCounter}`;
}

export function MeasurementOverlay({
  screenToNative,
  nativeToScreen,
  unitLabel = 'mm',
  active,
}: MeasurementOverlayProps) {
  const tool = useViewerStore((s) => s.tool);
  const measurements = useViewerStore((s) => s.measurements);
  const addMeasurement = useViewerStore((s) => s.addMeasurement);
  const removeMeasurement = useViewerStore((s) => s.removeMeasurement);
  const setTool = useViewerStore((s) => s.setTool);

  /** In-progress measurement points (native coords). */
  const [draft, setDraft] = useState<WorldPoint[]>([]);
  /** Live cursor (screen coords) — for in-progress preview line. */
  const [cursor, setCursor] = useState<Point2D | null>(null);
  /** Force re-render on zoom/pan from the engine. */
  const [, setTick] = useState(0);
  const overlayRef = useRef<SVGSVGElement | null>(null);

  // When the tool changes, abandon any in-progress draft.
  useEffect(() => {
    setDraft([]);
    setCursor(null);
  }, [tool]);

  // Rerender when zoom/pan changes elsewhere — cheap, no diffing needed.
  useEffect(() => {
    const onAnything = () => setTick((t) => (t + 1) | 0);
    window.addEventListener('resize', onAnything);
    return () => window.removeEventListener('resize', onAnything);
  }, []);

  // Subscribe to viewer-state changes that affect projection (zoom/rotation/page).
  const zoom = useViewerStore((s) => s.zoom);
  const rotation = useViewerStore((s) => s.rotation);
  const page = useViewerStore((s) => s.page);
  useEffect(() => {
    setTick((t) => (t + 1) | 0);
  }, [zoom, rotation, page]);

  const kind = TOOL_TO_KIND[tool];

  const finishDraft = useCallback(
    (points: WorldPoint[], k: MeasurementKind) => {
      if (k === 'distance' && points.length === 2) {
        const value = distance(points[0]!, points[1]!);
        addMeasurement({
          id: newId(),
          kind: 'distance',
          points,
          value,
          unitLabel,
          createdAt: Date.now(),
        });
      } else if (k === 'polyline' && points.length >= 2) {
        const value = polylineLength(points);
        addMeasurement({
          id: newId(),
          kind: 'polyline',
          points,
          value,
          unitLabel,
          createdAt: Date.now(),
        });
      } else if (k === 'area' && points.length >= 3) {
        const value = polygonArea(points);
        const perimeter = polygonPerimeter(points);
        addMeasurement({
          id: newId(),
          kind: 'area',
          points,
          value,
          perimeter,
          unitLabel,
          createdAt: Date.now(),
        });
      }
    },
    [addMeasurement, unitLabel],
  );

  // Esc / Enter to finish polyline/area. Esc aborts distance mid-flight.
  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (draft.length === 0) {
          setTool('pan');
          return;
        }
        if ((kind === 'polyline' && draft.length >= 2) || (kind === 'area' && draft.length >= 3)) {
          finishDraft(draft, kind);
        }
        setDraft([]);
        setCursor(null);
        // Esc also exits the tool back to pan, matching DESIGN behaviour.
        setTool('pan');
      } else if (e.key === 'Enter') {
        if ((kind === 'polyline' && draft.length >= 2) || (kind === 'area' && draft.length >= 3)) {
          finishDraft(draft, kind);
          setDraft([]);
          setCursor(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kind, draft, finishDraft, setTool]);

  // Pointer handlers — relative to the overlay element.
  const getRelative = useCallback((e: { clientX: number; clientY: number }): Point2D => {
    const el = overlayRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!kind) return;
      const screen = getRelative(e);
      const native = screenToNative(screen);
      if (!native) return;
      if (kind === 'distance') {
        if (draft.length === 0) {
          setDraft([native]);
        } else {
          const points = [draft[0]!, native];
          finishDraft(points, 'distance');
          setDraft([]);
          setCursor(null);
        }
      } else {
        // polyline / area — accumulate
        setDraft((d) => [...d, native]);
      }
    },
    [draft, finishDraft, getRelative, kind, screenToNative],
  );

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!kind || draft.length === 0) {
        setCursor(null);
        return;
      }
      setCursor(getRelative(e));
    },
    [draft.length, getRelative, kind],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (kind === 'area' && draft.length >= 3) {
        finishDraft(draft, 'area');
        setDraft([]);
        setCursor(null);
        e.preventDefault();
        e.stopPropagation();
      } else if (kind === 'polyline' && draft.length >= 2) {
        finishDraft(draft, 'polyline');
        setDraft([]);
        setCursor(null);
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [draft, finishDraft, kind],
  );

  // Helpers — project arrays of native points to screen, dropping any null
  // (e.g. point on a different PDF page than current view).
  const project = useCallback(
    (points: WorldPoint[]): Point2D[] => {
      const out: Point2D[] = [];
      for (const p of points) {
        const s = nativeToScreen(p);
        if (s) out.push(s);
      }
      return out;
    },
    [nativeToScreen],
  );

  // Rendered measurements (committed). project() returns null for points
  // belonging to a different native space (e.g. PDF measurements while DXF
  // tab is active), so we drop those entirely.
  const renderedCommitted = useMemo(() => {
    return measurements
      .map((m) => ({ m, screen: project(m.points) }))
      .filter((r) => r.screen.length === r.m.points.length);
  }, [measurements, project]);

  return (
    <svg
      ref={overlayRef}
      className="absolute inset-0 h-full w-full"
      style={{
        // Only steal pointer events while a measure tool is active.
        pointerEvents: active ? 'auto' : 'none',
        cursor: active ? 'crosshair' : 'default',
      }}
      onClick={onClick}
      onMouseMove={onMove}
      onDoubleClick={onDoubleClick}
      role="presentation"
    >
      {/* Committed measurements */}
      {renderedCommitted.map(({ m, screen }) => (
        <CommittedMeasurement
          key={m.id}
          measurement={m}
          screenPoints={screen}
          onDelete={() => removeMeasurement(m.id)}
        />
      ))}

      {/* In-progress draft */}
      {kind && draft.length > 0
        ? (() => {
            const screen = project(draft);
            if (screen.length === 0) return null;
            const previewEnd = cursor ?? screen[screen.length - 1]!;
            return (
              <DraftMeasurement
                kind={kind}
                screenPoints={screen}
                preview={previewEnd}
                unitLabel={unitLabel}
              />
            );
          })()
        : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const STROKE = 'hsl(221 83% 53%)'; // brand-500
const STROKE_LIGHT = 'rgba(37, 99, 235, 0.6)';
const FILL = 'rgba(37, 99, 235, 0.12)';

function CommittedMeasurement({
  measurement: m,
  screenPoints,
  onDelete,
}: {
  measurement: Measurement;
  screenPoints: Point2D[];
  onDelete: () => void;
}) {
  if (m.kind === 'distance') {
    const [a, b] = screenPoints;
    if (!a || !b) return null;
    const mid = midpoint(a, b);
    return (
      <g className="group">
        <line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={STROKE}
          strokeWidth={2}
        />
        <Endcap point={a} />
        <Endcap point={b} />
        <Label
          point={mid}
          text={formatLength(m.value, m.unitLabel)}
          onClick={onDelete}
        />
      </g>
    );
  }
  if (m.kind === 'polyline') {
    const path = pointsToPath(screenPoints, false);
    const labelPoint = centroid(screenPoints);
    return (
      <g className="group">
        <path d={path} fill="none" stroke={STROKE} strokeWidth={2} />
        {screenPoints.map((p, i) => (
          <Endcap key={i} point={p} />
        ))}
        <Label
          point={labelPoint}
          text={`Σ ${formatLength(m.value, m.unitLabel)}`}
          onClick={onDelete}
        />
      </g>
    );
  }
  // area
  const path = pointsToPath(screenPoints, true);
  const labelPoint = centroid(screenPoints);
  return (
    <g className="group">
      <path d={path} fill={FILL} stroke={STROKE} strokeWidth={2} />
      {screenPoints.map((p, i) => (
        <Endcap key={i} point={p} />
      ))}
      <Label
        point={labelPoint}
        text={
          formatArea(m.value, m.unitLabel) +
          (m.perimeter != null
            ? ` · P ${formatLength(m.perimeter, m.unitLabel)}`
            : '')
        }
        onClick={onDelete}
      />
    </g>
  );
}

function DraftMeasurement({
  kind,
  screenPoints,
  preview,
  unitLabel,
}: {
  kind: MeasurementKind;
  screenPoints: Point2D[];
  preview: Point2D;
  unitLabel: string;
}) {
  if (kind === 'distance') {
    const start = screenPoints[0]!;
    const total = distance(start, preview);
    const mid = midpoint(start, preview);
    return (
      <g>
        <line
          x1={start.x}
          y1={start.y}
          x2={preview.x}
          y2={preview.y}
          stroke={STROKE_LIGHT}
          strokeWidth={2}
          strokeDasharray="4 4"
        />
        <Endcap point={start} />
        <Endcap point={preview} hollow />
        <Label point={mid} text={formatScreenLength(total, unitLabel)} muted />
      </g>
    );
  }
  if (kind === 'polyline') {
    const all = [...screenPoints, preview];
    return (
      <g>
        <path
          d={pointsToPath(all, false)}
          fill="none"
          stroke={STROKE_LIGHT}
          strokeWidth={2}
          strokeDasharray="4 4"
        />
        {screenPoints.map((p, i) => (
          <Endcap key={i} point={p} />
        ))}
        <Endcap point={preview} hollow />
        <Label
          point={preview}
          text={`Σ ${formatScreenLength(polylineLength(all), unitLabel)}`}
          muted
          dx={12}
          dy={-12}
        />
      </g>
    );
  }
  // area
  const all = [...screenPoints, preview];
  return (
    <g>
      <path
        d={pointsToPath(all, true)}
        fill={FILL}
        stroke={STROKE_LIGHT}
        strokeWidth={2}
        strokeDasharray="4 4"
      />
      {screenPoints.map((p, i) => (
        <Endcap key={i} point={p} />
      ))}
      <Endcap point={preview} hollow />
      <Label
        point={preview}
        text="더블클릭으로 완료"
        muted
        dx={12}
        dy={-12}
      />
    </g>
  );
}

function pointsToPath(points: Point2D[], closed: boolean): string {
  if (points.length === 0) return '';
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i]!.x} ${points[i]!.y}`;
  }
  if (closed) d += ' Z';
  return d;
}

function Endcap({ point, hollow }: { point: Point2D; hollow?: boolean }) {
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={4}
      fill={hollow ? 'white' : STROKE}
      stroke={STROKE}
      strokeWidth={1.5}
    />
  );
}

function Label({
  point,
  text,
  muted,
  onClick,
  dx = 0,
  dy = 0,
}: {
  point: Point2D;
  text: string;
  muted?: boolean;
  onClick?: () => void;
  dx?: number;
  dy?: number;
}) {
  const padX = 6;
  const padY = 2;
  // Approximate width: 7px per char (rough). SVG text doesn't measure ahead.
  const w = Math.max(40, text.length * 7);
  const h = 18;
  const cx = point.x + dx;
  const cy = point.y + dy;
  return (
    <g
      transform={`translate(${cx - w / 2}, ${cy - h / 2})`}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={(e) => {
        if (!onClick) return;
        e.stopPropagation();
        onClick();
      }}
    >
      <rect
        width={w}
        height={h}
        rx={3}
        ry={3}
        fill="white"
        stroke={muted ? STROKE_LIGHT : STROKE}
        strokeWidth={1}
      />
      <text
        x={padX}
        y={h / 2 + 4}
        fontSize={11}
        fontFamily="ui-monospace, monospace"
        fill={muted ? '#374151' : STROKE}
      >
        {text}
      </text>
      {onClick ? (
        <title>{`${text} — 클릭하여 삭제`}</title>
      ) : null}
      <rect
        width={w}
        height={h}
        fill="transparent"
        // Padding keeps the label hit area crisp.
        x={-padX}
        y={-padY}
      />
    </g>
  );
}

function formatScreenLength(value: number, unit: string): string {
  return formatLength(value, unit);
}
