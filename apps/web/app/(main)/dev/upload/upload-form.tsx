'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileWarning, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

type Status =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string }
  | { kind: 'converting'; filename: string }
  | { kind: 'done'; viewerUrl: string; durationMs: number }
  | { kind: 'error'; message: string };

const ACCEPT = '.dwg,.dxf';
const MAX_BYTES = 100 * 1024 * 1024;

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files.item(0);
      if (!file) return;
      const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
      if (!['.dwg', '.dxf'].includes(ext)) {
        setStatus({
          kind: 'error',
          message: `지원하지 않는 형식입니다: ${ext || '(없음)'} — DWG 또는 DXF만 가능합니다.`,
        });
        return;
      }
      if (file.size > MAX_BYTES) {
        setStatus({
          kind: 'error',
          message: `파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)} MB > 100 MB).`,
        });
        return;
      }

      setStatus({ kind: 'uploading', filename: file.name });
      const fd = new FormData();
      fd.append('file', file);

      try {
        // Optimistically flip to 'converting' once the bytes are in flight —
        // the server-side step is the slow part anyway.
        const res = await fetch('/api/v1/dev/ingest-dwg', {
          method: 'POST',
          body: fd,
        });
        // Update label after upload bytes are flushed.
        setStatus({ kind: 'converting', filename: file.name });
        const json = (await res.json()) as
          | { id: string; viewerUrl: string; conversion: 'success'; durationMs: number }
          | { error: string; detail?: string; conversion?: string };

        if (!res.ok || !('viewerUrl' in json)) {
          const msg =
            ('error' in json ? json.error : null) ?? `업로드 실패 (${res.status})`;
          setStatus({ kind: 'error', message: msg });
          return;
        }

        setStatus({
          kind: 'done',
          viewerUrl: json.viewerUrl,
          durationMs: json.durationMs,
        });
        router.push(json.viewerUrl);
      } catch (err) {
        setStatus({
          kind: 'error',
          message: (err as Error).message || '네트워크 오류',
        });
      }
    },
    [router],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      void handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const busy = status.kind === 'uploading' || status.kind === 'converting';

  return (
    <div className="max-w-2xl space-y-4">
      <div
        role="button"
        tabIndex={0}
        aria-busy={busy}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) {
            inputRef.current?.click();
          }
        }}
        className={cn(
          'app-panel flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center transition-colors',
          dragOver ? 'border-brand-500 bg-brand-500/5' : 'border-border',
          busy ? 'cursor-wait' : 'cursor-pointer hover:border-brand-500/60',
        )}
      >
        {busy ? (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-brand-500" />
            <div className="text-sm font-medium text-fg">
              {status.kind === 'uploading' ? '업로드 중…' : '변환 중…'}
            </div>
            <div className="text-xs text-fg-muted">{status.filename}</div>
          </>
        ) : (
          <>
            <Upload className="h-10 w-10 text-fg-muted" />
            <div className="text-sm font-medium text-fg">
              파일을 여기로 드롭하거나 클릭하세요
            </div>
            <div className="text-xs text-fg-muted">
              DWG · DXF · 최대 100 MB
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              파일 선택
            </Button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {status.kind === 'error' && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">업로드 실패</div>
            <div className="break-words opacity-90">{status.message}</div>
          </div>
        </div>
      )}

      {status.kind === 'done' && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4" />
          <span>
            변환 완료 ({status.durationMs}ms) — 미리보기로 이동합니다…
          </span>
        </div>
      )}
    </div>
  );
}
