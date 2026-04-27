'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

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

import type { AdminUserListItem } from './types';

/**
 * R29 §A.9 — UserDeactivateDialog. Strong confirm: the admin must type the
 * exact username to enable [비활성화]. Soft-deletes via `DELETE
 * /api/v1/admin/users/{id}` (BE sets `deletedAt` and flips employmentType
 * to RETIRED).
 *
 * PM-DECISION-5 default = require username typed match.
 */

export interface UserDeactivateDialogProps {
  user: Pick<AdminUserListItem, 'id' | 'username' | 'fullName'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function UserDeactivateDialog({
  user,
  open,
  onOpenChange,
  onConfirm,
}: UserDeactivateDialogProps): JSX.Element {
  const [typed, setTyped] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (open) {
      setTyped('');
      const id = window.requestAnimationFrame(() => cancelRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
    return;
  }, [open]);

  const matches = typed === user.username;

  const handleConfirm = async () => {
    if (!matches) return;
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            사용자 비활성화
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-fg">{user.fullName}</span>
            <span className="ml-1 font-mono text-fg-muted">({user.username})</span>{' '}
            계정을 비활성화합니다.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 text-xs text-fg-muted">
          <li>· 이 사용자는 더 이상 로그인할 수 없습니다.</li>
          <li>
            · 사용자명(<span className="font-mono">{user.username}</span>)은
            보존되어 활동 이력에 계속 표시됩니다.
          </li>
          <li>
            · 보유한 자료의 소유권은 그대로 유지되며, 필요 시 슈퍼관리자가
            이전할 수 있습니다.
          </li>
        </ul>

        <div className="space-y-1.5">
          <Label htmlFor="deactivate-confirm">
            정말 비활성화하려면 사용자명을 입력하세요
          </Label>
          <Input
            id="deactivate-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={user.username}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

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
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={!matches || pending}
          >
            {pending ? '처리 중...' : '비활성화'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
