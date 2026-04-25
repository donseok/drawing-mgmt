'use client';

/**
 * ViewerSidebar — right-side 320px panel with tabs:
 *   - layers     (DXF only)
 *   - pages      (PDF only)
 *   - measurements (always)
 *   - properties (always; pulls from AttachmentMeta)
 *
 * Collapsible — when closed, the canvas claims the full width.
 */

import { Eye, EyeOff, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  formatArea,
  formatLength,
} from '@/lib/viewer/measurements';
import type { AttachmentMeta, SidebarTab } from '@/lib/viewer/types';
import { useViewerStore } from '@/lib/viewer/use-viewer-state';

export interface ViewerSidebarProps {
  meta: AttachmentMeta | null;
  /** Called when the user clicks a page in the Pages tab. */
  onSelectPage?: (page: number) => void;
}

export function ViewerSidebar({ meta, onSelectPage }: ViewerSidebarProps) {
  const open = useViewerStore((s) => s.sidebarOpen);
  const setOpen = useViewerStore((s) => s.setSidebarOpen);
  const tab = useViewerStore((s) => s.sidebarTab);
  const setTab = useViewerStore((s) => s.setSidebarTab);
  const mode = useViewerStore((s) => s.mode);

  if (!open) return null;

  return (
    <aside
      aria-label="뷰어 사이드바"
      className="hidden h-full w-80 shrink-0 flex-col border-l border-border bg-bg-subtle md:flex"
    >
      <div className="flex h-9 items-center justify-between border-b border-border px-2">
        <Tabs current={tab} onChange={setTab} mode={mode} />
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="사이드바 닫기"
          className="rounded p-1 text-fg-muted hover:bg-bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'layers' ? <LayersTab /> : null}
        {tab === 'pages' ? <PagesTab onSelect={onSelectPage} /> : null}
        {tab === 'measurements' ? <MeasurementsTab /> : null}
        {tab === 'properties' ? <PropertiesTab meta={meta} /> : null}
      </div>
    </aside>
  );
}

function Tabs({
  current,
  onChange,
  mode,
}: {
  current: SidebarTab;
  onChange: (t: SidebarTab) => void;
  mode: 'pdf' | 'dxf';
}) {
  // Order intentionally puts mode-specific tab first.
  const tabs: Array<{ id: SidebarTab; label: string; show: boolean }> = [
    { id: 'layers', label: '레이어', show: mode === 'dxf' },
    { id: 'pages', label: '페이지', show: mode === 'pdf' },
    { id: 'measurements', label: '측정', show: true },
    { id: 'properties', label: '속성', show: true },
  ];
  return (
    <div role="tablist" className="flex items-center gap-0.5">
      {tabs
        .filter((t) => t.show)
        .map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={current === t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex h-7 items-center rounded px-2 text-xs font-medium transition-colors',
              current === t.id
                ? 'bg-bg text-fg shadow-sm'
                : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layers (DXF)
// ---------------------------------------------------------------------------

function LayersTab() {
  const layers = useViewerStore((s) => s.layers);
  const toggleLayer = useViewerStore((s) => s.toggleLayer);
  const setAllLayers = useViewerStore((s) => s.setAllLayers);

  const allOn = layers.length > 0 && layers.every((l) => l.visible);
  const allOff = layers.length > 0 && layers.every((l) => !l.visible);

  if (layers.length === 0) {
    return (
      <div className="p-4 text-sm text-fg-muted">
        DXF 도면이 로드되면 레이어 목록이 여기에 표시됩니다.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={allOn}
          onClick={() => setAllLayers(true)}
        >
          모두 켜기
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={allOff}
          onClick={() => setAllLayers(false)}
        >
          모두 끄기
        </Button>
        <span className="ml-auto text-xs text-fg-muted">{layers.length}개</span>
      </div>
      <ul className="divide-y divide-border" role="list">
        {layers.map((l) => (
          <li
            key={l.name}
            className={cn(
              'flex items-center gap-2 px-3 py-2',
              l.frozen && 'opacity-50',
            )}
          >
            <button
              type="button"
              onClick={() => toggleLayer(l.name)}
              aria-label={`${l.displayName} 레이어 토글`}
              className="rounded p-1 hover:bg-bg-muted"
            >
              {l.visible ? (
                <Eye className="h-4 w-4 text-brand" />
              ) : (
                <EyeOff className="h-4 w-4 text-fg-muted" />
              )}
            </button>
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-sm border border-border"
              style={{ background: l.colorHex ?? '#888' }}
            />
            <span
              className="flex-1 truncate font-mono text-xs"
              title={l.displayName}
            >
              {l.displayName}
            </span>
            {l.frozen ? (
              <span className="text-[10px] uppercase text-fg-subtle">FROZEN</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pages (PDF)
// ---------------------------------------------------------------------------

function PagesTab({ onSelect }: { onSelect?: (n: number) => void }) {
  const page = useViewerStore((s) => s.page);
  const pageCount = useViewerStore((s) => s.pageCount);
  const setPage = useViewerStore((s) => s.setPage);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <div>
      <div className="border-b border-border px-3 py-2 text-xs text-fg-muted">
        {page} / {pageCount}
      </div>
      <ul className="grid grid-cols-2 gap-2 p-2" role="list">
        {pages.map((p) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => {
                setPage(p);
                onSelect?.(p);
              }}
              className={cn(
                'flex h-24 w-full flex-col items-center justify-center rounded border bg-white text-xs text-fg-muted transition-colors hover:border-brand',
                p === page
                  ? 'border-brand ring-2 ring-brand/30'
                  : 'border-border',
              )}
            >
              <span className="font-mono text-base text-fg">{p}</span>
              <span>페이지</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

function MeasurementsTab() {
  const measurements = useViewerStore((s) => s.measurements);
  const removeMeasurement = useViewerStore((s) => s.removeMeasurement);
  const clearMeasurements = useViewerStore((s) => s.clearMeasurements);

  if (measurements.length === 0) {
    return (
      <div className="space-y-2 p-4 text-sm text-fg-muted">
        <p>
          툴바의 <span className="text-fg">측정</span> 메뉴 또는{' '}
          <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[11px]">
            M
          </kbd>{' '}
          단축키로 시작하세요.
        </p>
        <ul className="list-inside list-disc space-y-1 text-xs">
          <li>2점 거리 — 두 지점 클릭</li>
          <li>다중점 거리 — 클릭으로 점 추가, ESC/Enter로 종료</li>
          <li>면적 — 점 추가 후 더블클릭/ESC로 닫기</li>
        </ul>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-fg-muted">{measurements.length}개</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={clearMeasurements}
          className="h-6 text-xs"
        >
          <Trash2 className="size-3" /> 모두 삭제
        </Button>
      </div>
      <ul className="divide-y divide-border" role="list">
        {measurements.map((m) => (
          <li
            key={m.id}
            className="flex items-start justify-between gap-2 px-3 py-2 text-xs"
          >
            <div className="min-w-0">
              <div className="font-medium text-fg">
                {m.kind === 'distance'
                  ? '2점 거리'
                  : m.kind === 'polyline'
                    ? '다중점 거리'
                    : '면적'}
              </div>
              <div className="font-mono text-fg-muted">
                {m.kind === 'area'
                  ? formatArea(m.value, m.unitLabel)
                  : formatLength(m.value, m.unitLabel)}
              </div>
              {m.perimeter != null ? (
                <div className="font-mono text-[11px] text-fg-subtle">
                  둘레 {formatLength(m.perimeter, m.unitLabel)}
                </div>
              ) : null}
              <div className="text-[11px] text-fg-subtle">
                점 {m.points.length}개
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeMeasurement(m.id)}
              aria-label="측정 삭제"
              className="shrink-0 rounded p-1 text-fg-muted hover:bg-bg-muted hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

function PropertiesTab({ meta }: { meta: AttachmentMeta | null }) {
  if (!meta) {
    return <div className="p-4 text-sm text-fg-muted">메타데이터 없음</div>;
  }
  const rows: Array<[string, string]> = [
    ['도면번호', meta.objectNumber],
    ['자료명', meta.objectName],
    ['파일명', meta.filename],
    ['MIME', meta.mimeType],
    ['크기', meta.size > 0 ? formatBytes(meta.size) : '—'],
    ['마스터파일', meta.isMaster ? '예' : '아니오'],
    ['변환 상태', meta.conversionStatus],
    [
      '미리보기',
      [
        meta.hasPdf ? 'PDF' : null,
        meta.hasDxf ? 'DXF' : null,
        meta.hasThumbnail ? '썸네일' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ],
  ];
  return (
    <dl className="divide-y divide-border text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[6rem_1fr] gap-2 px-3 py-2">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="break-all font-mono text-fg">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
