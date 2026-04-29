'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';

/**
 * NewObjectDialog — "새 자료 등록" form, wraps `<Modal>`.
 *
 * Skeleton form built with `react-hook-form` + `zod`. The wiring to the
 * BE create-object API is the FE consumer's responsibility — pass an
 * `onSubmit` that takes the validated form values and returns a Promise.
 * On success the dialog closes; on error it stays open with the user's
 * input intact (the consumer should surface a toast).
 *
 * Folder and class options are hard-coded for the skeleton; real values
 * will arrive once BE-1's folder/class endpoints are live.
 *
 * @example
 *   const [open, setOpen] = useState(false);
 *   <NewObjectDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     folderId={currentFolderId}
 *     onSubmit={async (values) => {
 *       await api.createObject(values);
 *     }}
 *   />
 */
export interface NewObjectFormValues {
  folderId: string;
  classCode: string;
  name: string;
  description?: string;
  /** Empty = autogenerate at the server. */
  number?: string;
  securityLevel: 1 | 2 | 3 | 4 | 5;
}

export interface NewObjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Default folder; the form lets the user override. */
  folderId?: string;
  /** Called with the validated values; FE wires the API call. */
  onSubmit?: (values: NewObjectFormValues) => Promise<void> | void;
}

// --- Static skeleton options ---------------------------------------------

const FOLDER_OPTIONS = [
  { value: 'ROOT', label: 'ROOT' },
  { value: 'CGL-MEC', label: 'CGL / 기계 (MEC)' },
  { value: 'CGL-ELE', label: 'CGL / 전기 (ELE)' },
  { value: 'CGL-INS', label: 'CGL / 계측 (INS)' },
  { value: 'CGL-PRC', label: 'CGL / 공정 (PRC)' },
] as const;

const CLASS_OPTIONS = [
  { value: 'MEC', label: 'MEC — 기계' },
  { value: 'ELE', label: 'ELE — 전기' },
  { value: 'INS', label: 'INS — 계측' },
  { value: 'PRC', label: 'PRC — 공정' },
  { value: 'GEN', label: 'GEN — 일반' },
] as const;

const SECURITY_OPTIONS = [
  { value: '1', label: '1 — 공개' },
  { value: '2', label: '2 — 사내' },
  { value: '3', label: '3 — 부서' },
  { value: '4', label: '4 — 제한' },
  { value: '5', label: '5 — 기밀' },
] as const;

// --- Zod schema -----------------------------------------------------------

const schema = z.object({
  folderId: z.string().min(1, '폴더를 선택하세요.'),
  classCode: z.string().min(1, '자료유형을 선택하세요.'),
  name: z
    .string()
    .min(1, '자료명을 입력하세요.')
    .max(200, '자료명은 200자 이내로 입력하세요.'),
  number: z
    .string()
    .max(64, '도면번호는 64자 이내로 입력하세요.')
    .optional()
    .or(z.literal('')),
  description: z
    .string()
    .max(1000, '설명은 1000자 이내로 입력하세요.')
    .optional()
    .or(z.literal('')),
  securityLevel: z.union([
    z.literal('1'),
    z.literal('2'),
    z.literal('3'),
    z.literal('4'),
    z.literal('5'),
  ]),
});

type FormShape = z.infer<typeof schema>;

const DEFAULTS: FormShape = {
  folderId: '',
  classCode: '',
  name: '',
  number: '',
  description: '',
  securityLevel: '2',
};

// --- Component ------------------------------------------------------------

export function NewObjectDialog({
  open,
  onOpenChange,
  folderId,
  onSubmit,
}: NewObjectDialogProps): JSX.Element {
  // Stabilize the initial form values across renders — RHF reads
  // defaultValues by reference, and the open→close lifecycle should not
  // re-mount the form just because the parent passed a fresh inline object.
  const initialValuesRef = React.useRef<FormShape>({
    ...DEFAULTS,
    folderId: folderId ?? '',
  });
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: initialValuesRef.current,
  });

  // Reset only on the open transition (false→true); guarding by a ref keeps
  // the effect from firing on render churn (e.g. parent re-render with the
  // same `open=true`) which previously chained into Radix Dialog's presence
  // logic and produced "Maximum update depth exceeded".
  const wasOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      reset({ ...DEFAULTS, folderId: folderId ?? '' });
    }
    wasOpenRef.current = open;
  }, [open, folderId, reset]);

  const submit = handleSubmit(async (raw) => {
    const values: NewObjectFormValues = {
      folderId: raw.folderId,
      classCode: raw.classCode,
      name: raw.name.trim(),
      securityLevel: Number(raw.securityLevel) as 1 | 2 | 3 | 4 | 5,
      ...(raw.number && raw.number.trim() ? { number: raw.number.trim() } : {}),
      ...(raw.description && raw.description.trim()
        ? { description: raw.description.trim() }
        : {}),
    };
    try {
      await onSubmit?.(values);
      onOpenChange(false);
    } catch {
      // Keep dialog open; consumer is responsible for surfacing the error.
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="새 자료 등록"
      description="자료의 기본 정보를 입력하세요. 빈 도면번호는 서버에서 자동 발번됩니다."
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
          <Button type="submit" form="new-object-form" disabled={isSubmitting}>
            {isSubmitting ? '등록 중…' : '등록'}
          </Button>
        </>
      }
    >
      <form
        id="new-object-form"
        onSubmit={submit}
        className="flex flex-col gap-4"
        noValidate
      >
        {/* 폴더 + 자료유형 (2-col on sm+) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="폴더"
            required
            htmlFor="folderId"
            error={errors.folderId?.message}
          >
            <Controller
              control={control}
              name="folderId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="folderId" aria-invalid={!!errors.folderId}>
                    <SelectValue placeholder="폴더 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {FOLDER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          <Field
            label="자료유형"
            required
            htmlFor="classCode"
            error={errors.classCode?.message}
          >
            <Controller
              control={control}
              name="classCode"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="classCode" aria-invalid={!!errors.classCode}>
                    <SelectValue placeholder="유형 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        </div>

        <Field label="자료명" required htmlFor="name" error={errors.name?.message}>
          <Input
            id="name"
            placeholder="예: CGL 1호기 라인 배치도"
            aria-invalid={!!errors.name}
            {...register('name')}
          />
        </Field>

        <Field
          label="도면번호"
          htmlFor="number"
          error={errors.number?.message}
          help="비워두면 자동발번됩니다."
        >
          <Input
            id="number"
            placeholder="예: DCM-CGL-MEC-0001"
            aria-invalid={!!errors.number}
            {...register('number')}
          />
        </Field>

        <Field
          label="보안등급"
          required
          htmlFor="securityLevel"
          error={errors.securityLevel?.message}
        >
          <Controller
            control={control}
            name="securityLevel"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="securityLevel"
                  aria-invalid={!!errors.securityLevel}
                >
                  <SelectValue placeholder="등급 선택" />
                </SelectTrigger>
                <SelectContent>
                  {SECURITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Field
          label="설명"
          htmlFor="description"
          error={errors.description?.message}
        >
          <Textarea
            id="description"
            placeholder="자료에 대한 간단한 설명 (선택)"
            rows={3}
            aria-invalid={!!errors.description}
            {...register('description')}
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
        <p
          role="alert"
          className={cn('text-xs text-danger')}
        >
          {error}
        </p>
      ) : help ? (
        <p className="text-xs text-fg-subtle">{help}</p>
      ) : null}
    </div>
  );
}
