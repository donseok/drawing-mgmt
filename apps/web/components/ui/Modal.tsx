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
import { cn } from '@/lib/cn';

/**
 * Modal — High-level dialog wrapper around `@radix-ui/react-dialog`
 * (consumed via the existing `Dialog*` primitives in `./dialog.tsx`).
 *
 * Use this when you want a controlled modal with a title, optional
 * description, content area, and a footer (typically primary/secondary
 * action buttons). For confirm/destructive flows use `<ConfirmDialog>`.
 *
 * Sizes (max-width):
 *   - sm  → 384px (w-96)
 *   - md  → 480px (default)
 *   - lg  → 640px
 *
 * Focus management, scroll-locking, Esc-to-close, and overlay-click-to-close
 * are all handled by Radix Dialog under the hood.
 *
 * @example
 *   const [open, setOpen] = useState(false);
 *   <Modal
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="자료 등록"
 *     description="새 자료의 기본 정보를 입력하세요."
 *     footer={
 *       <>
 *         <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
 *         <Button onClick={handleSubmit}>등록</Button>
 *       </>
 *     }
 *   >
 *     <FormFields />
 *   </Modal>
 */
export interface ModalProps {
  /** Controlled open state. */
  open: boolean;
  /** Called when Radix wants to change the open state (Esc, overlay click, X). */
  onOpenChange: (open: boolean) => void;
  /** Required visible title — also used by screen readers. */
  title: string;
  /** Optional secondary description shown under the title. */
  description?: string;
  /** Width preset. Default `md` (480px). */
  size?: 'sm' | 'md' | 'lg';
  /** Modal body content. */
  children: React.ReactNode;
  /** Optional footer (typically action buttons). */
  footer?: React.ReactNode;
  /** Optional className for the inner content panel. */
  className?: string;
}

const sizeClass: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-sm', // 384px
  md: 'sm:max-w-[480px]',
  lg: 'sm:max-w-2xl', // 672px ~ "lg"
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  children,
  footer,
  className,
}: ModalProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(sizeClass[size], className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex flex-col gap-4">{children}</div>
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
