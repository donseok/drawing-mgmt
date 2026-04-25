'use client';

import Link from 'next/link';
import { Maximize2, X, Image as ImageIcon, Download } from 'lucide-react';
import type { ObjectRow } from './ObjectTable';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/StatusBadge';

interface ObjectPreviewPanelProps {
  row: ObjectRow | null;
  onClose?: () => void;
}

export function ObjectPreviewPanel({ row, onClose }: ObjectPreviewPanelProps) {
  return (
    <aside
      aria-label="자료 미리보기"
      className={cn(
        'flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-bg-subtle',
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
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-fg-muted">
          <ImageIcon className="h-8 w-8 text-fg-subtle" />
          <p>자료를 선택하면 미리보기가 표시됩니다.</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-auto">
          <div className="m-3 overflow-hidden rounded-lg border border-border bg-bg">
            <div className="flex h-9 items-center justify-between gap-2 border-b border-border px-3">
              <span className="truncate font-mono text-[12px] font-medium text-fg">{row.number}</span>
              <StatusBadge status={row.state} size="sm" />
            </div>
            <div className="aspect-[4/3] bg-bg">
              {row.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.thumbnailUrl} alt="" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px),linear-gradient(0deg,hsl(var(--border))_1px,transparent_1px)] bg-[size:24px_24px] text-fg-subtle">
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-bg/90 shadow-sm">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                </div>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-[88px_1fr] gap-y-2 px-4 pb-4 text-[12px]">
            <dt className="text-fg-muted">도면번호</dt>
            <dd className="font-mono text-fg">{row.number}</dd>
            <dt className="text-fg-muted">자료명</dt>
            <dd className="font-medium text-fg">{row.name}</dd>
            <dt className="text-fg-muted">자료유형</dt>
            <dd className="text-fg">{row.classLabel}</dd>
            <dt className="text-fg-muted">상태</dt>
            <dd><StatusBadge status={row.state} size="sm" /></dd>
            <dt className="text-fg-muted">Rev / Ver</dt>
            <dd className="font-mono text-fg">R{row.revision} v{row.version}</dd>
            <dt className="text-fg-muted">등록자</dt>
            <dd className="text-fg">{row.registrant}</dd>
            <dt className="text-fg-muted">등록일</dt>
            <dd className="font-mono text-fg">{row.registeredAt}</dd>
          </dl>

          <div className="mt-auto flex gap-2 border-t border-border bg-bg p-3">
            {row.masterAttachmentId && (
              <Link
                href={`/viewer/${row.masterAttachmentId}`}
                className={cn(
                  'app-action-button-primary h-9 flex-1',
                )}
              >
                <Maximize2 className="h-4 w-4" /> 열기
              </Link>
            )}
            <Link
              href={`/objects/${row.id}`}
              className="app-action-button h-9"
            >
              상세
            </Link>
            <button
              type="button"
              aria-label="다운로드"
              className="app-icon-button h-9 w-9 border border-border bg-bg"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
