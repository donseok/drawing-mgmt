'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Maximize2, X, Image as ImageIcon, ArrowRight } from 'lucide-react';
import type { ObjectRow } from './ObjectTable';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { DrawingPlaceholder } from '@/components/DrawingPlaceholder';

interface ObjectPreviewPanelProps {
  row: ObjectRow | null;
  onClose?: () => void;
}

/**
 * Thumbnail dominates; metadata + actions collapse into a compact footer so
 * the preview stays usable in a 320–420px column. Detail/history/markup live
 * on `/objects/[id]` — do not re-add tabs here.
 */
function ObjectPreviewPanelImpl({ row, onClose }: ObjectPreviewPanelProps) {
  return (
    <aside
      aria-label="자료 미리보기"
      className={cn(
        'hidden h-full shrink-0 flex-col border-l border-border bg-bg md:flex',
        'md:w-[320px] xl:w-[420px]',
      )}
    >
      <div className="app-panel-header min-h-11">
        <span className="app-kicker">도면 미리보기</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="app-icon-button h-7 w-7"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!row ? (
        <EmptyState
          icon={ImageIcon}
          title="자료를 선택하면 미리보기가 표시됩니다."
          className="m-3 flex-1 border-0"
        />
      ) : (
        <div className="flex flex-1 min-h-0 flex-col">
          <div className="app-panel m-3 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
              <span className="truncate font-mono text-[12px] font-medium text-fg">
                {row.number}
              </span>
              <StatusBadge status={row.state} size="sm" />
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[hsl(var(--viewer-canvas))]">
              {row.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain"
                />
              ) : (
                <DrawingPlaceholder gridSize={24} cardClassName="h-20 w-20" />
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-bg-subtle px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-fg">{row.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-fg-muted">
              {row.classLabel} · R{row.revision} v{row.version} · {row.registrant}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              {row.masterAttachmentId && (
                <Link
                  href={`/viewer/${row.masterAttachmentId}`}
                  className="app-action-button-primary h-8 flex-1"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  열기
                </Link>
              )}
              <Link
                href={`/objects/${row.id}`}
                className="app-action-button h-8"
              >
                상세
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export const ObjectPreviewPanel = memo(ObjectPreviewPanelImpl);
