'use client';

// R33 D-5 — BackupRunDialog (kind picker + confirm).
//
// Two-step modal:
//   1) admin picks kind (POSTGRES | FILES) via radio cards.
//   2) clicking "지금 실행" POSTs to /api/v1/admin/backups/run; the page-level
//      mutation handles invalidation + toast. We close on success.
//
// PM decision (api_contract §4 / PM note): a single ConfirmDialog-equivalent
// is enough — backups don't take destructive actions on existing data, they
// just produce new files. The kind picker is the only meaningful choice, so
// it lives inline in the dialog body rather than a separate prompt.

import * as React from 'react';
import { Database, FolderArchive, Loader2, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

import type { BackupKind } from './types';

export interface BackupRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Caller runs the mutation; we just collect the kind and await. */
  onConfirm: (kind: BackupKind) => Promise<void>;
  /** Pending state from the parent mutation, so the button shows a spinner. */
  pending?: boolean;
}

interface KindOption {
  kind: BackupKind;
  label: string;
  description: string;
  icon: LucideIcon;
}

const KIND_OPTIONS: KindOption[] = [
  {
    kind: 'POSTGRES',
    label: 'Postgres 데이터베이스',
    description: 'pg_dump 결과를 gzip 압축해 저장합니다. 도면 메타데이터 전체 포함.',
    icon: Database,
  },
  {
    kind: 'FILES',
    label: '파일 저장소',
    description: '도면 파일 저장 디렉토리를 tar.gz로 묶어 저장합니다. 용량이 클 수 있습니다.',
    icon: FolderArchive,
  },
];

export function BackupRunDialog({
  open,
  onOpenChange,
  onConfirm,
  pending = false,
}: BackupRunDialogProps): JSX.Element {
  const [kind, setKind] = React.useState<BackupKind>('POSTGRES');

  // Reset to POSTGRES whenever the dialog reopens so the radio doesn't keep a
  // stale FILES selection from a previous invocation.
  React.useEffect(() => {
    if (open) setKind('POSTGRES');
  }, [open]);

  async function handleConfirm() {
    await onConfirm(kind);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return; // block closing mid-flight
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>백업 즉시 실행</DialogTitle>
          <DialogDescription>
            큐에 백업 작업을 추가합니다. 실행 중인 백업이 있으면 직렬로 처리됩니다.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2" aria-label="백업 종류">
          <legend className="sr-only">백업 종류 선택</legend>
          {KIND_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = kind === opt.kind;
            return (
              <label
                key={opt.kind}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                  selected
                    ? 'border-brand bg-brand/5'
                    : 'border-border hover:bg-bg-subtle',
                  pending && 'pointer-events-none opacity-50',
                )}
              >
                <input
                  type="radio"
                  name="backup-kind"
                  value={opt.kind}
                  checked={selected}
                  onChange={() => setKind(opt.kind)}
                  disabled={pending}
                  className="mt-1 h-4 w-4 border-border text-brand"
                />
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted" aria-hidden="true" />
                <div className="space-y-0.5">
                  <div className="text-sm font-medium text-fg">{opt.label}</div>
                  <div className="text-xs text-fg-muted">{opt.description}</div>
                </div>
              </label>
            );
          })}
        </fieldset>

        <p className="text-[11px] text-fg-subtle">
          저장된 백업은 30일 후 자동 삭제됩니다.
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            취소
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                실행 중…
              </>
            ) : (
              '지금 실행'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
