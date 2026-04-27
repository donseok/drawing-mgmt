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

import type { AdminOrganization } from './types';

/**
 * R30 §A.7 — OrgDeleteDialog. Two modes:
 *
 *   1) `target.childCount === 0 && target.userCount === 0` → confirmation
 *      (default — focus = cancel, [삭제] danger).
 *   2) Otherwise → 안내 모드 (cannot-delete). The page already disables the
 *      menu item but if the BE returns `E_STATE_CONFLICT` we fall through
 *      to this mode by setting `forceBlocked = true`.
 */
export interface OrgDeleteDialogProps {
  target: AdminOrganization;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  /** Force the cannot-delete mode (e.g. server returned E_STATE_CONFLICT). */
  forceBlocked?: boolean;
}

export function OrgDeleteDialog({
  target,
  open,
  onClose,
  onConfirm,
  forceBlocked = false,
}: OrgDeleteDialogProps): JSX.Element {
  const blocked =
    forceBlocked || target.childCount > 0 || target.userCount > 0;
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      const id = window.requestAnimationFrame(() => cancelRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
    return;
  }, [open]);

  const handleConfirm = async () => {
    try {
      setPending(true);
      await onConfirm();
    } finally {
      setPending(false);
    }
  };

  if (blocked) {
    const reasons: string[] = [];
    if (target.childCount > 0) reasons.push(`자식 조직 ${target.childCount}개`);
    if (target.userCount > 0) reasons.push(`소속 사용자 ${target.userCount}명`);

    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              삭제할 수 없습니다
            </DialogTitle>
            <DialogDescription>
              <span className="block">
                <span className="font-medium text-fg">{target.name}</span> 조직은
                다음 항목이 있어 삭제할 수 없습니다:
              </span>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <span className="mt-3 block text-fg-muted">
                먼저 자식 조직을 다른 부모로 이동하거나 사용자를 옮긴 뒤 다시
                시도하세요.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button ref={cancelRef} type="button" onClick={onClose}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>조직 삭제</DialogTitle>
          <DialogDescription>
            <span className="block">
              <span className="font-medium text-fg">{target.name}</span> 조직을
              삭제합니다.
            </span>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
              <li>자식 조직 0개, 소속 사용자 0명</li>
              <li>정렬 순서가 형제들 사이에서 자동 재계산됩니다.</li>
            </ul>
          </DialogDescription>
        </DialogHeader>
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
            disabled={pending}
          >
            {pending ? '삭제 중...' : '삭제'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
