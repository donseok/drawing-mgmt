'use client';

import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import type { AdminUserListItem } from './types';

/**
 * R29 §A.8 — UserUnlockDialog. Simple confirm: "lock 해제" + the user's
 * lockedUntil/failedLoginCount context. Default focus = 취소 (kept by the
 * outline button being first in the footer).
 */

export interface UserUnlockDialogProps {
  user: Pick<
    AdminUserListItem,
    'id' | 'username' | 'fullName' | 'lockedUntil' | 'failedLoginCount'
  >;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function UserUnlockDialog({
  user,
  open,
  onOpenChange,
  onConfirm,
}: UserUnlockDialogProps): JSX.Element {
  const [pending, setPending] = React.useState(false);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const handleConfirm = async () => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  const lockedUntilText = formatLockedUntil(user.lockedUntil);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>잠금 해제</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-fg">{user.fullName}</span>
            <span className="ml-1 font-mono text-fg-muted">({user.username})</span>{' '}
            계정의 잠금을 해제합니다.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 text-xs text-fg-muted">
          {typeof user.failedLoginCount === 'number' && user.failedLoginCount > 0 ? (
            <li>· {user.failedLoginCount}회 비밀번호 오입력으로 잠금됨</li>
          ) : null}
          {lockedUntilText ? (
            <li>· 자동 잠금 해제 시각: {lockedUntilText}</li>
          ) : null}
          <li>
            · 지금 해제하면 사용자는 즉시 다시 로그인할 수 있습니다. 비밀번호를
            모를 경우 별도로 [비밀번호 리셋]을 사용하세요.
          </li>
        </ul>

        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            취소
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={pending}>
            {pending ? '해제 중...' : '잠금 해제'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatLockedUntil(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}
