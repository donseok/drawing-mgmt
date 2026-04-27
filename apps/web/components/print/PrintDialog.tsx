'use client';

/**
 * PrintDialog — R31 P-1.
 *
 * Lets the user request a PDF render of an attachment with two options
 * (ctb mono|color-a3, pageSize A4|A3) and surfaces the worker's progress
 * via 250ms polling. On success, shows a download button + "브라우저 인쇄"
 * dropdown. Cached responses skip straight to the success state.
 *
 * Entry points (design_spec §A.1):
 *   1. Detail page action bar (`<ActionButton label="인쇄" …>`)
 *   2. Detail page header dropdown (`인쇄` item under `다운로드`)
 *   3. Search row dropdown (`<RowMenu onPrint={…}>`)
 *   4. ⌘P / Ctrl+P on the detail page (browser print intercepted)
 *
 * State machine (design_spec §A.4): IDLE → QUEUEING → QUEUED → RUNNING →
 * SUCCEEDED/CACHED/FAILED. `다시 시도` from FAILED returns to IDLE.
 *
 * Polling stops automatically on terminal status. Closing the dialog also
 * abandons the polling cycle (BE keeps working — next reopen will see the
 * job as CACHED).
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, Printer, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { FileTypeIcon } from '@/components/FileTypeIcon';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

// ── Public props ────────────────────────────────────────────────────────────

export interface PrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /** Print target. Required — dialog never opens without one. */
  attachmentId: string;
  /** Header label (display only). */
  filename: string;
  /** Optional bytes — rendered in the info row when truthy. */
  fileSize?: number;
  /** MIME type — used by FileTypeIcon. */
  fileMime?: string;
  /** Short context line, e.g. `R3 v0.2`. */
  contextLabel?: string;
}

// ── Form values + state ─────────────────────────────────────────────────────

type Ctb = 'mono' | 'color-a3';
type PageSize = 'A4' | 'A3';

interface PrintFormValues {
  ctb: Ctb;
  pageSize: PageSize;
}

type PrintState =
  | { kind: 'idle' }
  | { kind: 'queueing' }
  | { kind: 'queued'; jobId: string }
  | { kind: 'running'; jobId: string; progress?: number }
  | { kind: 'cached'; pdfUrl: string; cachedAt?: string }
  | { kind: 'succeeded'; pdfUrl: string }
  | { kind: 'failed'; errorMessage: string };

// BE response from POST /attachments/{id}/print + GET /print-jobs/{jobId}/status
type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CACHED';

interface PrintEnqueueResponse {
  jobId: string;
  status: JobStatus;
  pdfUrl?: string;
}

interface PrintStatusResponse {
  status: JobStatus;
  /** Optional 0-100. Some BE versions omit it (TBD-T1) → indeterminate UI. */
  progress?: number;
  pdfUrl?: string;
  errorMessage?: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export function PrintDialog({
  open,
  onOpenChange,
  attachmentId,
  filename,
  fileSize,
  fileMime,
  contextLabel,
}: PrintDialogProps) {
  const [form, setForm] = React.useState<PrintFormValues>({
    ctb: 'mono',
    pageSize: 'A4',
  });
  const [state, setState] = React.useState<PrintState>({ kind: 'idle' });

  // Reset on open. We don't reset on close so a quick reopen still has the
  // last user-picked options remembered (mirrors the pattern other dialogs
  // use, e.g. EditObjectDialog).
  React.useEffect(() => {
    if (open) {
      setState({ kind: 'idle' });
    }
  }, [open]);

  // Polling — only when we have a live jobId in QUEUED/RUNNING. The query
  // hook resolves into setState transitions via a memoized effect below.
  const isPolling =
    state.kind === 'queued' || state.kind === 'running';
  const pollingJobId = isPolling ? state.jobId : null;

  const statusQuery = useQuery<PrintStatusResponse, ApiError>({
    queryKey: queryKeys.print.status(pollingJobId ?? '__noop__'),
    queryFn: () =>
      api.get<PrintStatusResponse>(
        `/api/v1/print-jobs/${encodeURIComponent(pollingJobId!)}/status`,
      ),
    enabled: !!pollingJobId && open,
    // PM-DECISION-3 (design_spec §A.5) — 250ms.
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === 'SUCCEEDED' || s === 'FAILED' || s === 'CACHED') return false;
      return 250;
    },
    refetchIntervalInBackground: false,
  });

  // Drive state transitions from the polling result.
  React.useEffect(() => {
    if (!pollingJobId) return;
    const data = statusQuery.data;
    if (!data) return;
    if (data.status === 'RUNNING') {
      setState({
        kind: 'running',
        jobId: pollingJobId,
        progress: typeof data.progress === 'number' ? data.progress : undefined,
      });
    } else if (data.status === 'QUEUED') {
      setState({ kind: 'queued', jobId: pollingJobId });
    } else if (data.status === 'SUCCEEDED' && data.pdfUrl) {
      setState({ kind: 'succeeded', pdfUrl: data.pdfUrl });
    } else if (data.status === 'CACHED' && data.pdfUrl) {
      setState({ kind: 'cached', pdfUrl: data.pdfUrl });
    } else if (data.status === 'FAILED') {
      setState({
        kind: 'failed',
        errorMessage:
          data.errorMessage ?? '변환 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      });
    }
  }, [statusQuery.data, pollingJobId]);

  // Polling fetch error (network / 5xx). After 1 hard failure we surface to
  // the user — TanStack will retry idle queries 3x by default but the polling
  // mode treats each tick independently, so a single error here means trouble.
  React.useEffect(() => {
    if (!pollingJobId) return;
    const err = statusQuery.error;
    if (!err) return;
    setState({
      kind: 'failed',
      errorMessage: err.message ?? '상태 조회에 실패했습니다.',
    });
  }, [statusQuery.error, pollingJobId]);

  const enqueue = React.useCallback(async () => {
    setState({ kind: 'queueing' });
    try {
      const res = await api.post<PrintEnqueueResponse>(
        `/api/v1/attachments/${encodeURIComponent(attachmentId)}/print`,
        { ctb: form.ctb, pageSize: form.pageSize },
      );
      if (res.status === 'CACHED' && res.pdfUrl) {
        setState({ kind: 'cached', pdfUrl: res.pdfUrl });
      } else if (res.status === 'SUCCEEDED' && res.pdfUrl) {
        setState({ kind: 'succeeded', pdfUrl: res.pdfUrl });
      } else if (res.status === 'FAILED') {
        setState({
          kind: 'failed',
          errorMessage: '변환 요청이 거부되었습니다.',
        });
      } else {
        // QUEUED or RUNNING — kick polling.
        setState({ kind: 'queued', jobId: res.jobId });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '인쇄 요청 실패';
      // 401/403 → close dialog with toast (design_spec §A.8).
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        toast.error('인쇄 권한이 없습니다.');
        onOpenChange(false);
        return;
      }
      setState({ kind: 'failed', errorMessage: msg });
      toast.error('인쇄 요청 실패', { description: msg });
    }
  }, [attachmentId, form.ctb, form.pageSize, onOpenChange]);

  const downloadPdf = (pdfUrl: string) => {
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `${stripExt(filename)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openInBrowser = (pdfUrl: string) => {
    // Open in a new tab. Cross-origin PDFs typically render in the browser's
    // built-in viewer; the user can hit the print button there. We don't
    // attempt window.print() programmatically — see design_spec §A.4.
    window.open(pdfUrl, '_blank', 'noopener,noreferrer');
  };

  const close = () => onOpenChange(false);

  // Disable option chips while a job is in flight or already complete.
  const optionsLocked =
    state.kind === 'queueing' ||
    state.kind === 'queued' ||
    state.kind === 'running' ||
    state.kind === 'succeeded' ||
    state.kind === 'cached';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>인쇄 옵션</DialogTitle>
          <DialogDescription>
            PDF로 변환해 다운로드하거나 브라우저에서 인쇄할 수 있습니다. 큰
            도면은 1~2분 걸립니다.
          </DialogDescription>
        </DialogHeader>

        {/* Target file row */}
        <div className="flex items-center gap-3 rounded-md border border-border bg-bg-subtle px-3 py-2.5">
          <FileTypeIcon
            filename={filename}
            mimeType={fileMime}
            size="lg"
            className="shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[12px] font-semibold text-fg">
              {filename}
            </p>
            <p className="text-[11px] text-fg-muted">
              {[contextLabel, fileSize ? formatBytes(fileSize) : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>

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
            onChange={(v) =>
              setForm((f) => ({ ...f, pageSize: v as PageSize }))
            }
          />
        </div>

        {/* Status zone */}
        <PrintStatusZone state={state} pdfUrl={pdfUrlForState(state)} />

        <DialogFooter>
          <FooterActions
            state={state}
            onClose={close}
            onSubmit={enqueue}
            onRetry={() => setState({ kind: 'idle' })}
            onDownload={(url) => downloadPdf(url)}
            onOpenBrowser={(url) => openInBrowser(url)}
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
                // Roving-tabindex arrows for keyboard users.
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

function PrintStatusZone({
  state,
  pdfUrl,
}: {
  state: PrintState;
  pdfUrl: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle px-3 py-2.5">
      {state.kind === 'idle' && (
        <p className="text-xs text-fg-muted">
          “PDF 생성”을 누르면 변환을 시작합니다.
        </p>
      )}

      {state.kind === 'queueing' && (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <Spinner /> 요청 중…
        </p>
      )}

      {state.kind === 'queued' && (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <Spinner /> 대기 중…
        </p>
      )}

      {state.kind === 'running' && (
        <div className="space-y-1.5" aria-live="polite">
          <Progress
            value={state.progress}
            ariaValueText={
              state.progress !== undefined
                ? `${Math.round(state.progress)}% 변환 중`
                : '변환 중'
            }
          />
          <p className="text-[11px] text-fg-muted">
            {state.progress !== undefined
              ? `변환 중 · ${Math.round(state.progress)}%`
              : '변환 중…'}
          </p>
        </div>
      )}

      {state.kind === 'cached' && pdfUrl && (
        <p className="text-xs text-fg">
          이미 변환된 PDF가 있습니다. 아래 버튼으로 다운로드하거나 브라우저에서
          인쇄할 수 있습니다.
        </p>
      )}

      {state.kind === 'succeeded' && pdfUrl && (
        <p className="text-xs text-fg">변환 완료. 아래 버튼으로 받을 수 있습니다.</p>
      )}

      {state.kind === 'failed' && (
        <p className="text-xs text-danger">
          변환 실패: <span className="font-medium">{state.errorMessage}</span>
        </p>
      )}
    </div>
  );
}

function FooterActions({
  state,
  onClose,
  onSubmit,
  onRetry,
  onDownload,
  onOpenBrowser,
}: {
  state: PrintState;
  onClose: () => void;
  onSubmit: () => void;
  onRetry: () => void;
  onDownload: (url: string) => void;
  onOpenBrowser: (url: string) => void;
}) {
  if (state.kind === 'cached' || state.kind === 'succeeded') {
    return (
      <>
        <button type="button" onClick={onClose} className="app-action-button h-9">
          닫기
        </button>
        <div className="inline-flex h-9 items-stretch overflow-hidden rounded-md">
          <button
            type="button"
            onClick={() => onDownload(state.pdfUrl)}
            className="app-action-button-primary h-9 rounded-r-none"
          >
            <Printer className="h-4 w-4" />
            다운로드
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="추가 동작"
                className={cn(
                  'inline-flex h-9 items-center justify-center bg-brand px-2 text-brand-foreground transition-colors',
                  'hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'border-l border-brand-foreground/20 rounded-l-none',
                )}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4} className="min-w-[10rem]">
              <DropdownMenuItem onSelect={() => onOpenBrowser(state.pdfUrl)}>
                브라우저에서 인쇄
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </>
    );
  }

  if (state.kind === 'failed') {
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

  // queueing / queued / running — disable primary, allow close (it just stops
  // polling; BE worker keeps running, next reopen will see it as CACHED).
  const isWorking =
    state.kind === 'queueing' || state.kind === 'queued' || state.kind === 'running';

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
        disabled={isWorking}
        className="app-action-button-primary h-9 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Printer className="h-4 w-4" />
        {state.kind === 'queueing'
          ? '요청 중…'
          : state.kind === 'queued'
            ? '대기 중…'
            : state.kind === 'running'
              ? '변환 중…'
              : 'PDF 생성'}
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

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function stripExt(name: string): string {
  return name.replace(/\.[^./]+$/, '');
}

function pdfUrlForState(state: PrintState): string | null {
  if (state.kind === 'cached' || state.kind === 'succeeded') return state.pdfUrl;
  return null;
}
