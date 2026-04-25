'use client';

/**
 * Error boundary fallback for the viewer.
 *
 * Renders when:
 *  - PDF.js or dxf-viewer fails to initialize (CDN blocked, codec error, ...)
 *  - the conversion pipeline produced no preview AND we couldn't fall back
 *  - the file is too large / corrupt
 *
 * Always offers "원본 다운로드" so the user is never stuck.
 */

import { AlertTriangle, Download, X } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { previewUrl } from '@/lib/viewer/api';

export interface ViewerErrorProps {
  attachmentId: string;
  /** Short user-facing reason. The detail is logged separately. */
  message: string;
  /** Optional dev-only detail (stack, parser error, ...). */
  detail?: string;
  /** Called when the user clicks the close button. */
  onClose?: () => void;
}

export function ViewerError({
  attachmentId,
  message,
  detail,
  onClose,
}: ViewerErrorProps) {
  return (
    <div
      role="alert"
      className="flex h-full w-full items-center justify-center bg-bg p-8"
    >
      <div className="max-w-lg space-y-4 rounded-lg border border-border bg-bg-subtle p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle
            aria-hidden
            className="mt-0.5 h-5 w-5 shrink-0 text-warning"
          />
          <div className="space-y-1">
            <h2 className="text-base font-semibold">도면을 표시할 수 없습니다</h2>
            <p className="text-sm text-fg-muted">{message}</p>
          </div>
        </div>
        {detail ? (
          <pre className="max-h-32 overflow-auto rounded border border-border bg-bg p-2 text-xs text-fg-subtle">
            {detail}
          </pre>
        ) : null}
        <p className="text-xs text-fg-muted">
          변환에 실패한 경우에도 원본 파일은 그대로 다운로드할 수 있습니다.
        </p>
        <div className="flex items-center gap-2">
          <Button asChild variant="default">
            <a href={previewUrl(attachmentId, 'file')} download>
              <Download aria-hidden className="size-4" /> 원본 다운로드
            </a>
          </Button>
          {onClose ? (
            <Button variant="outline" onClick={onClose}>
              <X aria-hidden className="size-4" /> 닫기
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href="/">
                <X aria-hidden className="size-4" /> 닫기
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
