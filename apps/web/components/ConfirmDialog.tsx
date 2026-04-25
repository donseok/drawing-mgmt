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

/**
 * ConfirmDialog — DESIGN §9.3 (확인 모달).
 * - Required for destructive/sensitive actions: 삭제, 폐기, 결재 반려, 권한 변경
 * - Default focus = cancel (non-destructive)
 * - Primary button colored per `variant`
 *
 * Two usage modes:
 *
 *   1) Controlled (recommended):
 *      const [open, setOpen] = useState(false);
 *      <ConfirmDialog
 *        open={open}
 *        onOpenChange={setOpen}
 *        title="자료를 폐기하시겠습니까?"
 *        description="폐기 후 30일간 휴지통에서 복구할 수 있습니다."
 *        confirmText="폐기"
 *        variant="destructive"
 *        onConfirm={async () => { await deleteObject(); setOpen(false); }}
 *      />
 *
 *   2) Imperative (Promise):
 *      const result = await confirm({ title, description, confirmText, variant });
 *      if (result) { ... }
 *      (Bring your own provider — see `useConfirm` example in DESIGN docs.)
 */

type ConfirmVariant = 'default' | 'destructive';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  title: React.ReactNode;
  description?: React.ReactNode;

  confirmText?: React.ReactNode;
  cancelText?: React.ReactNode;

  /** Confirm-button color. `destructive` for delete/reject/revoke. */
  variant?: ConfirmVariant;

  /** Called when user confirms. Can be async; we await it before closing. */
  onConfirm?: () => void | Promise<void>;
  /** Called when user cancels (or Esc / Overlay click). */
  onCancel?: () => void;

  /** Disable the confirm button. */
  disabled?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = '확인',
  cancelText = '취소',
  variant = 'default',
  onConfirm,
  onCancel,
  disabled = false,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  // Default focus = cancel (DESIGN §9.3)
  React.useEffect(() => {
    if (open) {
      // Defer until Radix mounts the dialog
      const id = window.requestAnimationFrame(() => {
        cancelRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(id);
    }
    return;
  }, [open]);

  const handleConfirm = async () => {
    if (!onConfirm) {
      onOpenChange(false);
      return;
    }
    try {
      setPending(true);
      await onConfirm();
    } finally {
      setPending(false);
    }
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel?.();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={pending}
          >
            {cancelText}
          </Button>
          <Button
            type="button"
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={disabled || pending}
          >
            {pending ? '처리 중...' : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
