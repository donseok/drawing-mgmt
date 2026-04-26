'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

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
import { Textarea } from '@/components/ui/textarea';

// ── Zod schema ─────────────────────────────────────────────────────────────

const createClassSchema = z.object({
  code: z
    .string()
    .min(1, '코드를 입력하세요.')
    .max(30, '코드는 30자 이내로 입력하세요.')
    .regex(
      /^[A-Z0-9_-]+$/,
      '대문자 영숫자, 밑줄(_), 하이픈(-)만 사용할 수 있습니다.',
    ),
  name: z
    .string()
    .min(1, '명칭을 입력하세요.')
    .max(100, '명칭은 100자 이내로 입력하세요.'),
  description: z
    .string()
    .max(500, '설명은 500자 이내로 입력하세요.')
    .optional()
    .or(z.literal('')),
});

type CreateClassFormValues = z.infer<typeof createClassSchema>;

// ── Component ──────────────────────────────────────────────────────────────

interface CreateClassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CreateClassFormValues) => Promise<void>;
}

export function CreateClassDialog({
  open,
  onOpenChange,
  onSubmit,
}: CreateClassDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateClassFormValues>({
    resolver: zodResolver(createClassSchema),
    defaultValues: { code: '', name: '', description: '' },
  });

  // Force code to uppercase as user types
  const codeValue = watch('code');
  React.useEffect(() => {
    const upper = (codeValue ?? '').toUpperCase();
    if (upper !== codeValue) {
      setValue('code', upper, { shouldValidate: false });
    }
  }, [codeValue, setValue]);

  const handleFormSubmit = handleSubmit(async (values) => {
    await onSubmit({
      ...values,
      description: values.description || undefined,
    });
    reset();
    onOpenChange(false);
  });

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>새 자료유형 등록</DialogTitle>
          <DialogDescription>
            자료유형 코드는 생성 후 변경할 수 없습니다.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleFormSubmit} className="space-y-4">
          {/* Code */}
          <div className="space-y-1.5">
            <Label htmlFor="class-code" required>
              코드
            </Label>
            <Input
              id="class-code"
              placeholder="MEC"
              className="font-mono uppercase"
              {...register('code')}
            />
            {errors.code && (
              <p className="text-xs text-danger">{errors.code.message}</p>
            )}
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="class-name" required>
              명칭
            </Label>
            <Input
              id="class-name"
              placeholder="기계 도면"
              {...register('name')}
            />
            {errors.name && (
              <p className="text-xs text-danger">{errors.name.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="class-description">설명</Label>
            <Textarea
              id="class-description"
              placeholder="이 자료유형에 대한 설명을 입력하세요."
              rows={3}
              {...register('description')}
            />
            {errors.description && (
              <p className="text-xs text-danger">{errors.description.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '등록 중...' : '등록'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
