'use client';

/**
 * AttachmentUploadDialog — single-file upload for the object detail page.
 *
 * R31 V-INF-2 — files ≥ 5 MB are sent through the chunked upload helper
 * (`POST /uploads` → `PATCH /uploads/{id}` × N → `POST /uploads/{id}/finalize`)
 * with a live progress bar. Smaller files keep the legacy single-multipart
 * path so the success toast / cache invalidation flow is unchanged.
 *
 * The external props signature is identical to the pre-R31 version so callers
 * (object detail page) don't need any code changes.
 */

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Info, UploadCloud, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ApiError, apiRequest } from '@/lib/api-client';
import {
  cancelUpload,
  ChunkUploadError,
  uploadInChunks,
  type ChunkProgress,
  type ChunkRetryEvent,
} from '@/lib/chunk-upload';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

// File size threshold beyond which we switch to chunked upload (PM-DECISION-4).
const CHUNK_THRESHOLD = 5_000_000;
// Hard cap from contract §5.1 (2 GB).
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
// EMA alpha — 5s window at 250 ms sample.
const SPEED_EMA_ALPHA = 0.2;
// Sample period for the speed/ETA UI update.
const PROGRESS_SAMPLE_MS = 250;

// ── Types ───────────────────────────────────────────────────────────────────

interface UploadResponse {
  id: string;
  filename: string;
  mimeType: string;
  size: string;
  isMaster: boolean;
}

export interface AttachmentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objectId: string;
  /** True when the object has no master yet — preselects the isMaster checkbox. */
  isFirstAttachment?: boolean;
}

interface ChunkUiState {
  uploadedBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSec: number;
  chunkIdx: number;
  chunkTotal: number;
  retryNote?: string;
}

type DialogPhase =
  | { kind: 'idle' }
  | { kind: 'uploading-multipart' }
  | { kind: 'uploading-chunked'; ui: ChunkUiState; uploadId?: string }
  | { kind: 'finalizing'; uploadId: string }
  | {
      kind: 'error';
      message: string;
      retriable: boolean;
      uploadId?: string;
    }
  | { kind: 'done' };

// ── Component ───────────────────────────────────────────────────────────────

export function AttachmentUploadDialog({
  open,
  onOpenChange,
  objectId,
  isFirstAttachment,
}: AttachmentUploadDialogProps) {
  const queryClient = useQueryClient();

  const [file, setFile] = React.useState<File | null>(null);
  const [isMaster, setIsMaster] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);
  const [phase, setPhase] = React.useState<DialogPhase>({ kind: 'idle' });
  const [confirmCancelOpen, setConfirmCancelOpen] = React.useState(false);

  // Refs for the chunked path. AbortController lives across re-renders so we
  // can also cancel from useEffect cleanup (route change while uploading).
  const abortRef = React.useRef<AbortController | null>(null);
  // EMA + sample window for speed/ETA. We resample every 250 ms to keep the
  // UI smooth; raw onProgress events fire per-chunk PATCH (every ~5 MB).
  const sampleRef = React.useRef<{
    lastTickMs: number;
    lastBytes: number;
    speedEma: number;
  }>({ lastTickMs: 0, lastBytes: 0, speedEma: 0 });
  const sampleTimerRef = React.useRef<number | null>(null);
  const lastProgressRef = React.useRef<ChunkProgress | null>(null);
  const lastRetryRef = React.useRef<ChunkRetryEvent | null>(null);

  React.useEffect(() => {
    if (open) {
      setFile(null);
      setIsMaster(!!isFirstAttachment);
      setDragActive(false);
      setPhase({ kind: 'idle' });
      setConfirmCancelOpen(false);
    }
  }, [open, isFirstAttachment]);

  // Route change / unmount while uploading: abort + DELETE.
  React.useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      if (phase.kind === 'uploading-chunked' && phase.uploadId) {
        void cancelUpload(phase.uploadId);
      }
      stopSampler();
    };
    // We intentionally only run cleanup on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dialog close while actively uploading: confirm first.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (
      phase.kind === 'uploading-chunked' ||
      phase.kind === 'uploading-multipart' ||
      phase.kind === 'finalizing'
    ) {
      // <5% — no-confirm immediate cancel (design_spec §B.5).
      const pct =
        phase.kind === 'uploading-chunked'
          ? (phase.ui.uploadedBytes / Math.max(1, phase.ui.totalBytes)) * 100
          : 0;
      if (phase.kind !== 'uploading-multipart' && pct >= 5) {
        setConfirmCancelOpen(true);
        return;
      }
      cancelChunkUpload(true);
    }
    onOpenChange(false);
  };

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) acceptFile(dropped);
  };
  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragActive(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragActive(false);
  };

  const acceptFile = (f: File) => {
    if (f.size <= 0) {
      toast.error('빈 파일은 업로드할 수 없습니다.');
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      toast.error('파일은 2GB 이하만 가능합니다.');
      return;
    }
    setFile(f);
    setPhase({ kind: 'idle' });
  };

  // ── Multipart (legacy <5MB) ───────────────────────────────────────────────
  const multipartMutation = useMutation<UploadResponse, ApiError, FormData>({
    mutationFn: (form) =>
      apiRequest<UploadResponse>(`/api/v1/objects/${objectId}/attachments`, {
        method: 'POST',
        body: form,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.detail(objectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.activity(objectId),
      });
      toast.success(
        res.isMaster
          ? `${res.filename}을(를) 마스터로 추가했습니다.`
          : `${res.filename}을(를) 추가했습니다.`,
      );
      setPhase({ kind: 'done' });
      onOpenChange(false);
    },
    onError: (err) => {
      setPhase({
        kind: 'error',
        message: err.message ?? '첨부 업로드 실패',
        retriable: err.status >= 500,
      });
      toast.error('첨부 업로드 실패', { description: err.message });
    },
  });

  // ── Chunked (≥5MB) ────────────────────────────────────────────────────────
  const startSampler = () => {
    stopSampler();
    sampleRef.current = {
      lastTickMs: performance.now(),
      lastBytes: 0,
      speedEma: 0,
    };
    sampleTimerRef.current = window.setInterval(() => {
      const last = lastProgressRef.current;
      if (!last) return;
      const now = performance.now();
      const dtSec = Math.max(0.001, (now - sampleRef.current.lastTickMs) / 1000);
      const dBytes = Math.max(0, last.uploadedBytes - sampleRef.current.lastBytes);
      const sampleBps = dBytes / dtSec;
      const ema =
        SPEED_EMA_ALPHA * sampleBps + (1 - SPEED_EMA_ALPHA) * sampleRef.current.speedEma;
      sampleRef.current = {
        lastTickMs: now,
        lastBytes: last.uploadedBytes,
        speedEma: ema,
      };
      const remaining = Math.max(0, last.totalBytes - last.uploadedBytes);
      const eta = ema > 0 ? remaining / ema : Infinity;
      setPhase((prev) => {
        if (prev.kind !== 'uploading-chunked') return prev;
        return {
          ...prev,
          ui: {
            uploadedBytes: last.uploadedBytes,
            totalBytes: last.totalBytes,
            chunkIdx: last.chunkIdx,
            chunkTotal: last.chunkTotal,
            speedBps: ema,
            etaSec: eta,
            retryNote: prev.ui.retryNote,
          },
        };
      });
    }, PROGRESS_SAMPLE_MS);
  };

  const stopSampler = () => {
    if (sampleTimerRef.current !== null) {
      window.clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }
  };

  const startChunkedUpload = async () => {
    if (!file) {
      toast.error('파일을 선택하세요.');
      return;
    }
    abortRef.current = new AbortController();
    lastProgressRef.current = null;
    lastRetryRef.current = null;
    setPhase({
      kind: 'uploading-chunked',
      ui: {
        uploadedBytes: 0,
        totalBytes: file.size,
        speedBps: 0,
        etaSec: Infinity,
        chunkIdx: 0,
        chunkTotal: Math.max(1, Math.ceil(file.size / CHUNK_THRESHOLD)),
      },
    });
    startSampler();

    try {
      const result = await uploadInChunks(file, {
        objectId,
        isMaster,
        signal: abortRef.current.signal,
        onProgress: (p) => {
          lastProgressRef.current = p;
          // Clear retry hint once a chunk lands.
          setPhase((prev) =>
            prev.kind === 'uploading-chunked'
              ? {
                  ...prev,
                  ui: { ...prev.ui, retryNote: undefined },
                }
              : prev,
          );
          // When all chunks landed, flip into finalizing phase. The helper
          // still has finalize() to call after this last onProgress.
          if (p.uploadedBytes >= p.totalBytes) {
            stopSampler();
          }
        },
        onRetry: (ev) => {
          lastRetryRef.current = ev;
          const note = `전송 실패. 재시도(${ev.attempt}/${ev.maxAttempts})…`;
          setPhase((prev) =>
            prev.kind === 'uploading-chunked'
              ? { ...prev, ui: { ...prev.ui, retryNote: note } }
              : prev,
          );
        },
      });

      stopSampler();
      // Finalize succeeded — invalidate caches like the legacy multipart path.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.detail(objectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.activity(objectId),
      });
      toast.success(
        isMaster
          ? `${file.name}을(를) 마스터로 추가했습니다.`
          : `${file.name}을(를) 추가했습니다.`,
      );
      // Touch the conversion job id so the variable isn't unused; FE doesn't
      // poll it directly (admin/conversions page does), but logging keeps the
      // breadcrumb visible during dev.
      if (result.conversionJobId) {
        // eslint-disable-next-line no-console
        console.debug('[AttachmentUpload] conversion job', result.conversionJobId);
      }
      setPhase({ kind: 'done' });
      onOpenChange(false);
    } catch (err) {
      stopSampler();
      // Aborted — already cancelled by the user, don't toast.
      const isAbort =
        err instanceof DOMException && err.name === 'AbortError';
      if (isAbort) {
        setPhase({ kind: 'idle' });
        return;
      }
      const isChunkErr = err instanceof ChunkUploadError;
      const message =
        err instanceof Error ? err.message : '청크 업로드 실패';
      const retriable = isChunkErr ? err.retriable : true;
      setPhase({
        kind: 'error',
        message,
        retriable,
      });
      toast.error('업로드 실패', { description: message });
    }
  };

  const cancelChunkUpload = (silent: boolean) => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    stopSampler();
    if (!silent) toast('업로드 취소됨');
    setPhase({ kind: 'idle' });
  };

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!file) {
      toast.error('파일을 선택하세요.');
      return;
    }
    if (file.size < CHUNK_THRESHOLD) {
      const form = new FormData();
      form.append('file', file);
      if (isMaster) form.append('isMaster', 'true');
      setPhase({ kind: 'uploading-multipart' });
      multipartMutation.mutate(form);
      return;
    }
    void startChunkedUpload();
  };

  const handleRetry = () => {
    // For now `재시도` re-runs the whole flow (POST /uploads + chunks). The
    // BE creates a fresh upload session; the previous one's expiresAt cleans
    // up the orphan blob. design_spec §B.6 allows this — true resume from
    // the last good offset is Phase 2.
    if (!file) return;
    if (file.size < CHUNK_THRESHOLD) {
      handleSubmit();
    } else {
      void startChunkedUpload();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const isWorking =
    phase.kind === 'uploading-multipart' ||
    phase.kind === 'uploading-chunked' ||
    phase.kind === 'finalizing';

  const showChunkHint =
    !!file && file.size >= CHUNK_THRESHOLD && phase.kind === 'idle';

  const chunkPlanCount =
    file && file.size >= CHUNK_THRESHOLD
      ? Math.max(1, Math.ceil(file.size / CHUNK_THRESHOLD))
      : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>첨부 추가</DialogTitle>
            <DialogDescription>
              현재 자료의 작업 버전에 파일을 첨부합니다. 마스터로 지정하면 기존
              마스터는 보조로 변경됩니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-sm transition-colors',
                dragActive
                  ? 'border-brand bg-brand/5 text-brand'
                  : 'border-border bg-bg-subtle text-fg-muted hover:bg-bg-muted',
                isWorking && 'pointer-events-none opacity-60',
              )}
            >
              <input
                type="file"
                disabled={isWorking}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) acceptFile(f);
                }}
                className="hidden"
              />
              <UploadCloud
                className={cn(
                  'h-6 w-6',
                  dragActive ? 'text-brand' : 'text-fg-subtle',
                )}
                aria-hidden
              />
              {file ? (
                <span className="flex items-center gap-2 text-fg">
                  <span className="font-medium">{file.name}</span>
                  <span className="text-xs text-fg-muted">
                    ({formatBytes(file.size)})
                  </span>
                  {!isWorking ? (
                    <button
                      type="button"
                      aria-label="선택 해제"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setFile(null);
                        setPhase({ kind: 'idle' });
                      }}
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </span>
              ) : (
                <span>여기에 파일을 끌어다 놓거나 클릭해 선택하세요.</span>
              )}
            </label>

            <label
              className={cn(
                'flex items-center gap-2 text-sm',
                isWorking && 'opacity-60',
              )}
            >
              <input
                type="checkbox"
                disabled={isWorking}
                checked={isMaster}
                onChange={(e) => setIsMaster(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-brand"
              />
              <span>마스터로 지정</span>
            </label>

            {showChunkHint ? (
              <div className="flex items-start gap-2 rounded-md border border-brand/30 bg-brand/5 p-2 text-[11px] text-fg-muted">
                <Info className="mt-px h-3.5 w-3.5 shrink-0 text-brand" />
                <span>
                  5MB 청크로 {chunkPlanCount}분할 업로드. 중간 실패 시 자동
                  재개됩니다.
                </span>
              </div>
            ) : null}

            {phase.kind === 'uploading-chunked' ? (
              <ChunkProgressRegion ui={phase.ui} />
            ) : phase.kind === 'uploading-multipart' ? (
              <div className="space-y-1.5">
                <Progress />
                <p className="text-[11px] text-fg-muted">업로드 중…</p>
              </div>
            ) : phase.kind === 'finalizing' ? (
              <div className="space-y-1.5">
                <Progress value={100} />
                <p className="text-[11px] text-fg-muted">마무리 중…</p>
              </div>
            ) : phase.kind === 'error' ? (
              <p className="text-[12px] text-danger">{phase.message}</p>
            ) : null}
          </div>

          <DialogFooter>
            {phase.kind === 'uploading-chunked' ||
            phase.kind === 'uploading-multipart' ? (
              <>
                <button
                  type="button"
                  onClick={() => handleOpenChange(false)}
                  className="app-action-button h-9"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled
                  className="app-action-button-primary h-9 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <UploadCloud className="h-4 w-4" />
                  업로드 중…
                </button>
              </>
            ) : phase.kind === 'error' ? (
              <>
                <button
                  type="button"
                  onClick={() => handleOpenChange(false)}
                  className="app-action-button h-9"
                >
                  닫기
                </button>
                {phase.retriable ? (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="app-action-button-primary h-9"
                  >
                    <UploadCloud className="h-4 w-4" />
                    재시도
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleOpenChange(false)}
                  disabled={multipartMutation.isPending}
                  className="app-action-button h-9"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={multipartMutation.isPending || !file}
                  className="app-action-button-primary h-9 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <UploadCloud className="h-4 w-4" />
                  {file && file.size >= CHUNK_THRESHOLD
                    ? '청크 업로드 시작'
                    : '업로드'}
                </button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm-cancel for ≥5% chunked uploads. We keep this inside the
          dialog component so it doesn't need to be re-mounted by callers. */}
      <Dialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>업로드를 취소하시겠습니까?</DialogTitle>
            <DialogDescription>
              지금까지 업로드한 부분은 삭제됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmCancelOpen(false)}
              className="app-action-button h-9"
            >
              계속 업로드
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmCancelOpen(false);
                cancelChunkUpload(false);
                onOpenChange(false);
              }}
              className="app-action-button-primary h-9 bg-danger hover:bg-danger/90"
            >
              취소
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function ChunkProgressRegion({ ui }: { ui: ChunkUiState }) {
  const pct = ui.totalBytes > 0 ? (ui.uploadedBytes / ui.totalBytes) * 100 : 0;
  const speedLabel =
    ui.speedBps > 0 ? `${formatBytes(ui.speedBps)}/s` : '--';
  const etaLabel =
    !Number.isFinite(ui.etaSec) || ui.etaSec <= 0
      ? '계산 중…'
      : formatEta(ui.etaSec);

  const ariaText = `${formatBytes(ui.uploadedBytes)} / ${formatBytes(
    ui.totalBytes,
  )}, ${etaLabel}`;

  return (
    <div className="space-y-1.5" aria-live="polite">
      <Progress value={pct} ariaValueText={ariaText} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-fg-muted">
        <span>
          {formatBytes(ui.uploadedBytes)} / {formatBytes(ui.totalBytes)}
        </span>
        <span aria-hidden>·</span>
        <span>{speedLabel}</span>
        <span aria-hidden>·</span>
        <span>약 {etaLabel}</span>
      </div>
      <p className="text-[11px] text-fg-subtle">
        {ui.retryNote
          ? ui.retryNote
          : `청크 ${Math.min(ui.chunkIdx + 1, ui.chunkTotal)} / ${ui.chunkTotal} 전송 중`}
      </p>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatEta(sec: number): string {
  if (!Number.isFinite(sec)) return '계산 중…';
  if (sec >= 3600) return '1시간 이상 남음';
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}분 ${s}초 남음`;
  }
  if (sec < 1) return '< 1초 남음';
  return `${Math.round(sec)}초 남음`;
}
