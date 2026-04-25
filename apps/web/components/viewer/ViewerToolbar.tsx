'use client';

/**
 * ViewerToolbar — the top chrome of the fullscreen viewer (DESIGN §6.5).
 *
 * Layout (left → right):
 *   - Mode tabs (PDF | DXF) + title (도면번호 — 자료명)
 *   - Zoom group (out · readout · in · fit · 100%)
 *   - Rotate group (CCW · CW · 180°)
 *   - Tool group (measure menu · text search · layers panel)
 *   - View group (bg invert · line weight · fullscreen)
 *   - Action group (download · print · close)
 *
 * Buttons that don't fit on narrow screens collapse into responsive groups via
 * `hidden md:inline-flex`. Every button has a tooltip with the keyboard hint.
 */

import {
  ChevronDown,
  Download,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  Plus,
  Printer,
  Ruler,
  Search,
  Square,
  PenLine,
  RotateCcw,
  RotateCw,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { previewUrl } from '@/lib/viewer/api';
import type { AttachmentMeta, ToolMode } from '@/lib/viewer/types';
import { useViewerStore } from '@/lib/viewer/use-viewer-state';

export interface ViewerToolbarProps {
  meta: AttachmentMeta | null;
  /** Switch underlying engine. */
  onModeChange: (mode: 'pdf' | 'dxf') => void;
  /** Engine actions are passed in so the toolbar stays presentational. */
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onActualSize: () => void;
  onRotateCw: () => void;
  onRotateCcw: () => void;
  onRotate180: () => void;
  onToggleFullscreen: () => void;
  onPrint: () => void;
  onClose: () => void;
}

export function ViewerToolbar(props: ViewerToolbarProps) {
  const {
    meta,
    onModeChange,
    onZoomIn,
    onZoomOut,
    onFit,
    onActualSize,
    onRotateCw,
    onRotateCcw,
    onRotate180,
    onToggleFullscreen,
    onPrint,
    onClose,
  } = props;

  const mode = useViewerStore((s) => s.mode);
  const tool = useViewerStore((s) => s.tool);
  const setTool = useViewerStore((s) => s.setTool);
  const zoom = useViewerStore((s) => s.zoom);
  const invert = useViewerStore((s) => s.invertBackground);
  const toggleInvert = useViewerStore((s) => s.toggleInvert);
  const showLineWeight = useViewerStore((s) => s.showLineWeight);
  const toggleLineWeight = useViewerStore((s) => s.toggleLineWeight);
  const fullscreen = useViewerStore((s) => s.fullscreen);
  const setSidebarOpen = useViewerStore((s) => s.setSidebarOpen);
  const setSidebarTab = useViewerStore((s) => s.setSidebarTab);
  const sidebarOpen = useViewerStore((s) => s.sidebarOpen);
  const setSearchOpen = useViewerStore((s) => s.setSearchOpen);
  const searchOpen = useViewerStore((s) => s.searchOpen);

  const supportsDxf = meta?.hasDxf ?? false;
  const supportsPdf = meta?.hasPdf ?? true;

  return (
    <div className="flex h-12 items-center gap-1 border-b border-border bg-bg-subtle px-2 text-fg">
      {/* Title block */}
      <div className="mr-2 flex min-w-0 flex-1 items-center gap-3">
        <ModeTabs
          mode={mode}
          onChange={onModeChange}
          pdfEnabled={supportsPdf}
          dxfEnabled={supportsDxf}
        />
        <div className="min-w-0 truncate text-sm">
          <span className="font-mono text-fg-muted">
            {meta?.objectNumber ?? '—'}
          </span>
          <span className="mx-2 text-fg-subtle">·</span>
          <span className="font-medium">{meta?.objectName ?? '—'}</span>
        </div>
      </div>

      {/* Zoom group */}
      <Group>
        <IconBtn label="축소 (-)" onClick={onZoomOut}>
          <Minus />
        </IconBtn>
        <div className="flex h-7 min-w-[3.5rem] items-center justify-center rounded border border-border bg-bg px-2 font-mono text-xs">
          {Math.round(zoom * 100)}%
        </div>
        <IconBtn label="확대 (+)" onClick={onZoomIn}>
          <Plus />
        </IconBtn>
        <IconBtn label="화면맞춤 (0)" onClick={onFit}>
          <Maximize2 />
        </IconBtn>
        <IconBtn label="실제 크기 (1)" onClick={onActualSize}>
          <Square />
        </IconBtn>
      </Group>

      <Sep />

      {/* Rotate group */}
      <Group>
        <IconBtn label="좌측 회전 (Shift+R)" onClick={onRotateCcw}>
          <RotateCcw />
        </IconBtn>
        <IconBtn label="우측 회전 (R)" onClick={onRotateCw}>
          <RotateCw />
        </IconBtn>
        <IconBtn label="180° 회전" onClick={onRotate180}>
          <span className="text-xs font-semibold">180°</span>
        </IconBtn>
      </Group>

      <Sep />

      {/* Tool group */}
      <Group>
        <MeasureMenu tool={tool} setTool={setTool} />
        <IconBtn
          label="문자 검색 (T)"
          active={searchOpen}
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <Search />
        </IconBtn>
        <IconBtn
          label="레이어/페이지 (L)"
          active={sidebarOpen}
          onClick={() => {
            const next = !sidebarOpen;
            setSidebarOpen(next);
            if (next) setSidebarTab(mode === 'dxf' ? 'layers' : 'pages');
          }}
        >
          <Layers />
        </IconBtn>
      </Group>

      <Sep />

      {/* View group */}
      <Group>
        <IconBtn
          label="배경 반전 (B)"
          active={invert}
          onClick={toggleInvert}
        >
          <Moon />
        </IconBtn>
        <IconBtn
          label="선 가중치"
          active={showLineWeight}
          onClick={toggleLineWeight}
        >
          <PenLine />
        </IconBtn>
        <IconBtn
          label={fullscreen ? '전체화면 해제 (F)' : '전체화면 (F)'}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </IconBtn>
      </Group>

      <Sep />

      {/* Action group */}
      <Group>
        {meta ? (
          <Button
            asChild
            size="icon"
            variant="ghost"
            title="원본 다운로드"
            aria-label="원본 다운로드"
            className="h-8 w-8"
          >
            <a href={previewUrl(meta.id, 'file')} download>
              <Download />
            </a>
          </Button>
        ) : null}
        <IconBtn label="인쇄 (Ctrl+P)" onClick={onPrint}>
          <Printer />
        </IconBtn>
        <IconBtn label="닫기 (Esc)" onClick={onClose}>
          <X />
        </IconBtn>
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Sep() {
  return (
    <div className="hidden h-6 w-px shrink-0 bg-border md:block" aria-hidden />
  );
}

interface IconBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  children: React.ReactNode;
}

function IconBtn({
  label,
  active,
  children,
  className,
  ...rest
}: IconBtnProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md text-fg transition-colors',
        'hover:bg-bg-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        '[&_svg]:size-4',
        active && 'bg-brand text-brand-foreground hover:bg-brand-600',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function ModeTabs({
  mode,
  onChange,
  pdfEnabled,
  dxfEnabled,
}: {
  mode: 'pdf' | 'dxf';
  onChange: (m: 'pdf' | 'dxf') => void;
  pdfEnabled: boolean;
  dxfEnabled: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="뷰어 모드"
      className="inline-flex h-7 items-center rounded border border-border bg-bg p-0.5"
    >
      <ModeTab
        active={mode === 'pdf'}
        disabled={!pdfEnabled}
        onClick={() => onChange('pdf')}
      >
        PDF
      </ModeTab>
      <ModeTab
        active={mode === 'dxf'}
        disabled={!dxfEnabled}
        onClick={() => onChange('dxf')}
      >
        DXF
      </ModeTab>
    </div>
  );
}

function ModeTab({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center px-2 text-xs font-medium transition-colors',
        active
          ? 'rounded bg-brand text-brand-foreground'
          : 'text-fg-muted hover:text-fg',
        disabled && 'opacity-40',
      )}
    >
      {children}
    </button>
  );
}

function MeasureMenu({
  tool,
  setTool,
}: {
  tool: ToolMode;
  setTool: (t: ToolMode) => void;
}) {
  const [open, setOpen] = useState(false);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-measure-menu]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const isMeasuring = tool.startsWith('measure-');
  const labels: Record<ToolMode, string> = {
    pan: '측정',
    'measure-distance': '2점 거리',
    'measure-polyline': '다중점 거리',
    'measure-area': '면적',
  };

  return (
    <div className="relative" data-measure-menu>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="측정 (M)"
        aria-label="측정 도구"
        aria-expanded={open}
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
          'hover:bg-bg-muted',
          '[&_svg]:size-4',
          isMeasuring && 'bg-brand text-brand-foreground hover:bg-brand-600',
        )}
      >
        <Ruler />
        <span>{labels[tool]}</span>
        <ChevronDown className="size-3" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 min-w-[12rem] rounded-md border border-border bg-bg p-1 shadow-md"
        >
          <MenuItem
            active={tool === 'measure-distance'}
            onClick={() => {
              setTool('measure-distance');
              setOpen(false);
            }}
          >
            2점 거리 (Measure Distance)
          </MenuItem>
          <MenuItem
            active={tool === 'measure-polyline'}
            onClick={() => {
              setTool('measure-polyline');
              setOpen(false);
            }}
          >
            다중점 거리 (Polyline)
          </MenuItem>
          <MenuItem
            active={tool === 'measure-area'}
            onClick={() => {
              setTool('measure-area');
              setOpen(false);
            }}
          >
            면적 (Area)
          </MenuItem>
          <div className="my-1 h-px bg-border" />
          <MenuItem
            active={tool === 'pan'}
            onClick={() => {
              setTool('pan');
              setOpen(false);
            }}
          >
            측정 종료
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-bg-muted',
        active && 'bg-bg-muted font-medium',
      )}
    >
      {children}
    </button>
  );
}
