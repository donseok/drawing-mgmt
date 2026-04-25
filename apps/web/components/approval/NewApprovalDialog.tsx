'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';

/**
 * NewApprovalDialog — "결재 상신" form, wraps `<Modal>`.
 *
 * Skeleton form built with `react-hook-form` + `zod`. The wiring to the
 * BE submit-approval API is the FE consumer's responsibility — pass an
 * `onSubmit` that takes the validated form values and returns a Promise.
 *
 * Approver picker is intentionally minimal for the skeleton: a comma-
 * separated textarea of user IDs. Once BE-2's user-search endpoint is
 * live, FE-2 will replace this with a real chip selector.
 *
 * @example
 *   const [open, setOpen] = useState(false);
 *   <NewApprovalDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     objectId={selectedObjectId}
 *     onSubmit={async (values) => {
 *       await api.submitApproval(values);
 *     }}
 *   />
 */
export interface NewApprovalFormValues {
  objectId: string;
  title: string;
  /** Approver user IDs in approval order (top → bottom). */
  approvers: string[];
  comment?: string;
}

export interface NewApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Object whose new revision is being submitted. */
  objectId?: string;
  onSubmit?: (values: NewApprovalFormValues) => Promise<void> | void;
}

// --- Zod schema -----------------------------------------------------------

const schema = z.object({
  objectId: z.string().min(1, '대상 자료 ID를 입력하세요.'),
  title: z
    .string()
    .min(1, '결재 제목을 입력하세요.')
    .max(200, '제목은 200자 이내로 입력하세요.'),
  approversRaw: z
    .string()
    .min(1, '결재자 한 명 이상을 입력하세요.')
    .refine(
      (v) =>
        v
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean).length > 0,
      { message: '결재자 한 명 이상을 입력하세요.' },
    ),
  comment: z
    .string()
    .max(1000, '코멘트는 1000자 이내로 입력하세요.')
    .optional()
    .or(z.literal('')),
});

type FormShape = z.infer<typeof schema>;

const DEFAULTS: FormShape = {
  objectId: '',
  title: '',
  approversRaw: '',
  comment: '',
};

// --- Component ------------------------------------------------------------

export function NewApprovalDialog({
  open,
  onOpenChange,
  objectId,
  onSubmit,
}: NewApprovalDialogProps): JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: { ...DEFAULTS, objectId: objectId ?? '' },
  });

  // Reset when dialog opens with a (possibly new) target object.
  React.useEffect(() => {
    if (open) {
      reset({ ...DEFAULTS, objectId: objectId ?? '' });
    }
  }, [open, objectId, reset]);

  const submit = handleSubmit(async (raw) => {
    const approvers = raw.approversRaw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const values: NewApprovalFormValues = {
      objectId: raw.objectId.trim(),
      title: raw.title.trim(),
      approvers,
      ...(raw.comment && raw.comment.trim() ? { comment: raw.comment.trim() } : {}),
    };
    try {
      await onSubmit?.(values);
      onOpenChange(false);
    } catch {
      // Keep dialog open; consumer surfaces the error toast.
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="결재 상신"
      description="결재선을 지정하고 신규 리비전을 상신합니다."
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            취소
          </Button>
          <Button type="submit" form="new-approval-form" disabled={isSubmitting}>
            {isSubmitting ? '상신 중…' : '상신'}
          </Button>
        </>
      }
    >
      <form
        id="new-approval-form"
        onSubmit={submit}
        className="flex flex-col gap-4"
        noValidate
      >
        <Field
          label="자료"
          required
          htmlFor="objectId"
          error={errors.objectId?.message}
          help="자료 ID를 입력하세요. (검색 셀렉터는 추후 추가 예정)"
        >
          <Input
            id="objectId"
            placeholder="예: obj_01HXYZ…"
            aria-invalid={!!errors.objectId}
            {...register('objectId')}
          />
        </Field>

        <Field
          label="결재 제목"
          required
          htmlFor="title"
          error={errors.title?.message}
        >
          <Input
            id="title"
            placeholder="예: CGL 1호기 라인 배치도 Rev.B 승인 요청"
            aria-invalid={!!errors.title}
            {...register('title')}
          />
        </Field>

        <Field
          label="결재선"
          required
          htmlFor="approversRaw"
          error={errors.approversRaw?.message}
          help="결재자의 사용자 ID를 위에서 아래 순서로 입력하세요. 콤마 또는 줄바꿈으로 구분합니다."
        >
          <Textarea
            id="approversRaw"
            rows={3}
            placeholder={'usr_01HABC, usr_01HDEF\n또는 한 줄에 한 명씩'}
            aria-invalid={!!errors.approversRaw}
            {...register('approversRaw')}
          />
        </Field>

        <Field label="코멘트" htmlFor="comment" error={errors.comment?.message}>
          <Textarea
            id="comment"
            rows={3}
            placeholder="결재자에게 전달할 코멘트 (선택)"
            aria-invalid={!!errors.comment}
            {...register('comment')}
          />
        </Field>
      </form>
    </Modal>
  );
}

// --- tiny field wrapper ---------------------------------------------------

function Field({
  label,
  htmlFor,
  required,
  error,
  help,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  help?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error ? (
        <p role="alert" className={cn('text-xs text-danger')}>
          {error}
        </p>
      ) : help ? (
        <p className="text-xs text-fg-subtle">{help}</p>
      ) : null}
    </div>
  );
}
