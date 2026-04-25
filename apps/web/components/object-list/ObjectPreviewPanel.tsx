'use client';

import Link from 'next/link';
import { Maximize2, X, Image as ImageIcon, Download } from 'lucide-react';
import type { ObjectRow } from './ObjectTable';
import { cn } from '@/lib/cn';

interface ObjectPreviewPanelProps {
  row: ObjectRow | null;
  onClose?: () => void;
}

const STATE_LABEL: Record<ObjectRow['state'], string> = {
  NEW: '신규',
  CHECKED_OUT: '체크아웃 중',
  CHECKED_IN: '체크인 됨',
  IN_APPROVAL: '결재 진행 중',
  APPROVED: '승인됨',
  DELETED: '폐기됨',
};

export function ObjectPreviewPanel({ row, onClose }: ObjectPreviewPanelProps) {
  return (
    <aside
      aria-label="자료 미리보기"
      className={cn(
        'flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-bg-subtle',
      )}
    >
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">미리보기</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!row ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-fg-muted">
          <ImageIcon className="h-8 w-8 text-fg-subtle" />
          <p>자료를 선택하면 미리보기가 표시됩니다.</p>
          <p className="text-xs text-fg-subtle">Space 키로 토글</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-auto">
          <div className="aspect-[4/3] overflow-hidden border-b border-border bg-bg">
            {row.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.thumbnailUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-fg-subtle">
                <ImageIcon className="h-10 w-10" />
              </div>
            )}
          </div>

          <dl className="grid grid-cols-[80px_1fr] gap-y-2 px-3 py-3 text-[12px]">
            <dt className="text-fg-muted">도면번호</dt>
            <dd className="font-mono text-fg">{row.number}</dd>
            <dt className="text-fg-muted">자료명</dt>
            <dd className="text-fg">{row.name}</dd>
            <dt className="text-fg-muted">자료유형</dt>
            <dd className="text-fg">{row.classLabel}</dd>
            <dt className="text-fg-muted">상태</dt>
            <dd className="text-fg">{STATE_LABEL[row.state]}</dd>
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
                  'inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-brand text-sm font-medium text-brand-foreground',
                  'hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                )}
              >
                <Maximize2 className="h-4 w-4" /> 열기
              </Link>
            )}
            <Link
              href={`/objects/${row.id}`}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-bg px-3 text-sm hover:bg-bg-muted"
            >
              상세
            </Link>
            <button
              type="button"
              aria-label="다운로드"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-bg hover:bg-bg-muted"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
