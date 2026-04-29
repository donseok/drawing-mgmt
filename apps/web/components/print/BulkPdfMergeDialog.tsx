'use client';

/**
 * BulkPdfMergeDialog — R-PDF-MERGE (백로그 P-2 패리티).
 *
 * Lets the user request a single merged PDF for the current search-result
 * selection (1..50 objects) with two options (ctb mono|color-a3, pageSize
 * A4|A3) and surfaces the worker's progress via 1.5s polling. On status=DONE
 * the dialog triggers a hidden <a download> for `/print-jobs/{jobId}/merged.pdf`,
 * closes itself, and hands a completion summary back to the parent so the
 * page can toast a grouped per-row failure list (when failures.length > 0).
 *
 * Mounting: search/page.tsx mounts the dialog conditionally on a non-null
 * jobId or "open" trigger. The dialog itself owns the form, the mutation
 * call (via onSubmit prop), and the polling state machine. State machine:
 *   IDLE → QUEUEING → POLLING → DONE (auto-close) | FAILED | TIMEOUT.
 *
 * Closing during POLLING just stops the FE polling — the BE worker keeps
 * running and the user can re-trigger from a fresh dialog if needed (the
 * jobId is forgotten; this round assumes page-stay).
 */

import * as React from 'react';
import { Layers3, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';

// ── Public types ────────────────────────────────────────────────────────────

type Ctb = 'mono' | 'color-a3';
type PageSize = 'A4' | 'A3';

export interface BulkPdfMergeFormValues {
  ctb: Ctb;
  pageSize: PageSize;
}

export interface BulkPdfMergeFailure {
  objectId: string;
  reason: string;
}

export interface BulkPdfMergeCompletion {
  jobId: string;
  totalCount: number;
  successCount: number;
  failureCount: number;
  failures: BulkPdfMergeFailure[];
}

export interface BulkPdfMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ids preselected on the search page; dialog displays count + caps note. */
  selectedIds: string[];
  /**
   * Issue the BE mutation. Resolves to `{ jobId }` for polling, or null when
   * the parent has already surfaced the failure (e.g. pre-validation 422 with
   * grouped per-row toast). Throwing here will be caught & shown as FAILED.
   */
  onSubmit: (
    form: BulkPdfMergeFormValues,
  ) => Promise<{ jobId: string; objectCount: number } | null>;
  /** Fires once polling reports status=DONE (or partial success). */
  onComplete?: (summary: BulkPdfMergeCompletion) => void;
}

// ── BE response shape (contract §3.2) ───────────────────────────────────────

type JobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'QUEUED';

interface MergeStatusResponse {
  jobId: string;
  status: JobStatus;
  errorMessage?: string | null;
  pdfUrl?: string | null;
  kind?: 'PDF_MERGE' | 'PRINT';
  // PDF_MERGE-only fields. Workers fill them in as they process.
  totalCount?: number;
  successCount?: number;
  failureCount?: number;
  failures?: BulkPdfMergeFailure[];
}

// ── Internal state ──────────────────────────────────────────────────────────

type DialogState =
  | { kind: 'idle' }
  | { kind: 'queueing' }
  | {
      kind: 'polling';
      jobId: string;
      objectCount: number;
      successCount: number;
      totalCount: number;
    }
  | { kind: 'failed'; errorMessage: string }
  | { kind: 'timeout' };

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_BULK = 50;

// ── Component ───────────────────────────────────────────────────────────────

export function BulkPdfMergeDialog({
  open,
  onOpenChange,
  selectedIds,
  onSubmit,
  onComplete,
}: BulkPdfMergeDialogProps) {
  const [form, setForm] = React.useState<BulkPdfMergeFormValues>({
    ctb: 'mono',
    pageSize: 'A4',
  });
  const [state, setState] = React.useState<DialogState>({ kind: 'idle' });

  // Reset state on open. We intentionally keep the last-picked form values so
  // a re-open after a partial failure remembers them (mirrors PrintDialog).
  React.useEffect(() => {
    if (open) {
      setState({ kind: 'idle' });
    }
  }, [open]);

  const onCompleteRef = React.useRef(onComplete);
  React.useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Polling effect — runs only while state.kind === 'polling' and the dialog
  // is open. Driven by setInterval so a single tick can update the in-flight
  // progress (successCount/totalCount) without triggering a render storm.
  // We intentionally key the effect on (jobId, objectCount) — successCount /
  // totalCount updates from inside the tick shouldn't tear down and rebuild
  // the interval (the tick reads via setState updater).
  const pollingJobId = state.kind === 'polling' ? state.jobId : null;
  const pollingObjectCount = state.kind === 'polling' ? state.objectCount : null;

  React.useEffect(() => {
    if (!open) return;
    if (!pollingJobId || pollingObjectCount === null) return;

    const jobId = pollingJobId;
    const objectCount = pollingObjectCount;
    let cancelled = false;
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      // Hard cap — even if status is still PROCESSING, give up after 5min so
      // the user isn't held hostage. The BE job keeps running; user can come
      // back later. This round we don't persist jobId for resume.
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setState({ kind: 'timeout' });
        return;
      }
      try {
        const data = await api.get<MergeStatusResponse>(
          `/api/v1/print-jobs/${encodeURIComponent(jobId)}/status`,
        );
        if (cancelled) return;

        if (data.status === 'PROCESSING' || data.status === 'PENDING' || data.status === 'QUEUED') {
          setState((prev) =>
            prev.kind === 'polling'
              ? {
                  ...prev,
                  successCount: data.successCount ?? prev.successCount,
                  totalCount: data.totalCount ?? prev.totalCount,
                }
              : prev,
          );
        } else if (data.status === 'DONE') {
          // Trigger download via hidden <a> to honor the BE's
          // Content-Disposition (filename=drawings-YYYY-MM-DD.pdf).
          const url = data.pdfUrl ?? `/api/v1/print-jobs/${encodeURIComponent(jobId)}/merged.pdf`;
          triggerDownload(url);
          onCompleteRef.current?.({
            jobId,
            totalCount: data.totalCount ?? objectCount,
            successCount: data.successCount ?? objectCount,
            failureCount: data.failureCount ?? 0,
            failures: data.failures ?? [],
          });
          onOpenChange(false);
        } else if (data.status === 'FAILED') {
          setState({
            kind: 'failed',
            errorMessage:
              data.errorMessage ?? '병합에 실패했습니다. 잠시 후 다시 시도해주세요.',
          });
        }
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '상태 조회에 실패했습니다.';
        setState({ kind: 'failed', errorMessage: msg });
      }
    };

    // Fire once immediately so the user sees fresh status as soon as the
    // dialog enters polling, then every 1.5s.
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, pollingJobId, pollingObjectCount, onOpenChange]);

  const submit = React.useCallback(async () => {
    if (selectedIds.length === 0) return;
    setState({ kind: 'queueing' });
    try {
      const res = await onSubmit(form);
      if (!res) {
        // Parent handled it (e.g. pre-validation toast). Close the dialog so
        // the user can re-select.
        onOpenChange(false);
        return;
      }
      setState({
        kind: 'polling',
        jobId: res.jobId,
        objectCount: res.objectCount,
        successCount: 0,
        totalCount: res.objectCount,
      });
    } catch (err) {
      // ApiError 422 with grouped failures should have been surfaced by the
      // parent before this point (parent re-throws unrelated errors). Show
      // whatever message arrived, leave the dialog open so the user can
      // adjust ctb/pageSize and retry without re-selecting.
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : '병합 요청 실패';
      setState({ kind: 'failed', errorMessage: msg });
    }
  }, [form, onSubmit, onOpenChange, selectedIds.length]);

  const close = () => onOpenChange(false);
  const retry = () => setState({ kind: 'idle' });

  // Lock the form whenever a request is in flight or already terminal.
  const optionsLocked =
    state.kind === 'queueing' || state.kind === 'polling';

  const overflow = selectedIds.length > MAX_BULK;
  const selectionEmpty = selectedIds.length === 0;
  const submitDisabled =
    optionsLocked || overflow || selectionEmpty;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>PDF 병합 다운로드</DialogTitle>
          <DialogDescription>
            선택한 자료의 마스터 첨부를 단일 PDF로 합쳐 다운로드합니다. 큰
            도면이 포함되면 1~3분 걸릴 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        {/* Selection summary */}
        <div className="flex items-center gap-3 rounded-md border border-border bg-bg-subtle px-3 py-2.5">
          <Layers3 className="h-5 w-5 shrink-0 text-fg-subtle" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">
              {selectedIds.length.toLocaleString()}건 선택됨
            </p>
            <p className="text-[11px] text-fg-muted">
              한 번에 최대 {MAX_BULK}건까지 병합할 수 있습니다.
            </p>
          </div>
        </div>

        {overflow && (
          <p className="text-[11px] text-danger">
            선택이 최대 {MAX_BULK}건을 초과했습니다. 선택을 줄인 뒤 다시
            시도해주세요.
          </p>
        )}

        {/* Options */}
        <div className="space-y-3">
          <ChipRadioGroup
            legend="출력 방식"
            options={[
              { value: 'mono', label: '흑백' },
              { value: 'color-a3', label: '컬러 A3' },
            ]}
            value={form.ctb}
            disabled={optionsLocked}
            onChange={(v) => setForm((f) => ({ ...f, ctb: v as Ctb }))}
            help={
              form.ctb === 'mono'
                ? '모든 선을 검정으로 변환합니다.'
                : '원본 ACI 색상을 유지합니다.'
            }
          />
          <ChipRadioGroup
            legend="페이지 크기"
            options={[
              { value: 'A4', label: 'A4' },
              { value: 'A3', label: 'A3' },
            ]}
            value={form.pageSize}
            disabled={optionsLocked}
            onChange={(v) => setForm((f) => ({ ...f, pageSize: v as PageSize }))}
          />
        </div>

        {/* Status zone */}
        <StatusZone state={state} />

        <DialogFooter>
          <FooterActions
            state={state}
            submitDisabled={submitDisabled}
            onClose={close}
            onSubmit={submit}
            onRetry={retry}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

interface ChipRadioOption {
  value: string;
  label: string;
}

function ChipRadioGroup({
  legend,
  options,
  value,
  onChange,
  disabled,
  help,
}: {
  legend: string;
  options: ChipRadioOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  help?: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="app-kicker">{legend}</legend>
      <div role="radiogroup" aria-label={legend} className="flex gap-1.5">
        {options.map((opt) => {
          const checked = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  const idx = options.findIndex((o) => o.value === value);
                  const next = options[(idx + 1) % options.length]!;
                  onChange(next.value);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const idx = options.findIndex((o) => o.value === value);
                  const next =
                    options[(idx - 1 + options.length) % options.length]!;
                  onChange(next.value);
                }
              }}
              className={cn(
                'inline-flex h-8 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                checked
                  ? 'border-brand bg-brand text-brand-foreground'
                  : 'border-border bg-bg text-fg hover:bg-bg-muted',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {help ? <p className="text-[11px] text-fg-muted">{help}</p> : null}
    </fieldset>
  );
}

function StatusZone({ state }: { state: DialogState }) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle px-3 py-2.5">
      {state.kind === 'idle' && (
        <p className="text-xs text-fg-muted">
          “병합 PDF 생성”을 누르면 변환을 시작합니다.
        </p>
      )}

      {state.kind === 'queueing' && (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <Spinner /> 요청 중…
        </p>
      )}

      {state.kind === 'polling' && (
        <div className="space-y-1.5" aria-live="polite">
          <p className="flex items-center gap-2 text-xs text-fg-muted">
            <Spinner />
            변환 중… {state.successCount.toLocaleString()}/
            {state.totalCount.toLocaleString()}
          </p>
          <p className="text-[11px] text-fg-subtle">
            창을 닫아도 BE 작업은 계속 진행됩니다. 다운로드는 완료 후 자동
            시작됩니다.
          </p>
        </div>
      )}

      {state.kind === 'failed' && (
        <p className="text-xs text-danger">
          변환 실패: <span className="font-medium">{state.errorMessage}</span>
        </p>
      )}

      {state.kind === 'timeout' && (
        <p className="text-xs text-danger">
          변환에 5분 이상 소요되어 폴링을 중단했습니다. 잠시 후 다시
          시도해주세요. (서버 작업은 백그라운드에서 계속될 수 있습니다.)
        </p>
      )}
    </div>
  );
}

function FooterActions({
  state,
  submitDisabled,
  onClose,
  onSubmit,
  onRetry,
}: {
  state: DialogState;
  submitDisabled: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onRetry: () => void;
}) {
  if (state.kind === 'failed' || state.kind === 'timeout') {
    return (
      <>
        <button type="button" onClick={onClose} className="app-action-button h-9">
          닫기
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="app-action-button-primary h-9"
        >
          <RotateCcw className="h-4 w-4" />
          다시 시도
        </button>
      </>
    );
  }

  const isWorking =
    state.kind === 'queueing' || state.kind === 'polling';

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        className="app-action-button h-9"
        disabled={state.kind === 'queueing'}
      >
        닫기
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitDisabled}
        className="app-action-button-primary h-9 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Layers3 className="h-4 w-4" />
        {state.kind === 'queueing'
          ? '요청 중…'
          : isWorking
            ? '변환 중…'
            : '병합 PDF 생성'}
      </button>
    </>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-fg-subtle border-t-transparent"
    />
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function triggerDownload(url: string) {
  // Hidden <a download> click — same pattern as ZIP bulk download in
  // search/page.tsx. We let the BE supply the filename via Content-Disposition
  // (drawings-YYYY-MM-DD.pdf), so no `a.download` value is hard-coded here.
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
