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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { AdminGroupListItem } from './types';

/**
 * R30 §B.6 — GroupDeleteDialog. PM-DECISION-8 default: require typing the
 * group name to enable [삭제] (matches R29 user-deactivate pattern).
 *
 * Cascade: BE deletes UserGroup rows automatically (Prisma onDelete: Cascade).
 * The dialog calls this out so admins know the user accounts survive.
 */
export interface GroupDeleteDialogProps {
  target: AdminGroupListItem;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function GroupDeleteDialog({
  target,
  open,
  onClose,
  onConfirm,
}: GroupDeleteDialogProps): JSX.Element {
  const [confirmText, setConfirmText] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (open) {
      setConfirmText('');
      const id = window.requestAnimationFrame(() => cancelRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
    return;
  }, [open]);

  const matches = confirmText.trim() === target.name;

  const handleConfirm = async () => {
    if (!matches) return;
    try {
      setPending(true);
      await onConfirm();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>그룹 삭제</DialogTitle>
          <DialogDescription>
            <span className="block">
              <span className="font-medium text-fg">{target.name}</span> 그룹을
              삭제합니다.
            </span>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
              <li>현재 멤버 {target.memberCount}명의 멤버십이 함께 삭제됩니다.</li>
              <li>사용자 계정 자체는 그대로 유지됩니다.</li>
              <li>
                폴더 권한 매트릭스에서 이 그룹이 부여한 권한 행도 함께 사라집니다.
              </li>
            </ul>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border border-border bg-bg-subtle p-3">
          <Label htmlFor="group-delete-confirm">
            정말로 삭제하려면 그룹명을 입력하세요
          </Label>
          <Input
            id="group-delete-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={target.name}
            className="font-mono"
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={!matches || pending}
          >
            {pending ? '삭제 중...' : '삭제'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
