'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api-client';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력하세요.'),
    newPassword: z
      .string()
      .min(8, '새 비밀번호는 8자 이상이어야 합니다.')
      .max(128, '비밀번호는 128자 이하여야 합니다.'),
    confirmPassword: z.string().min(1, '비밀번호 확인을 입력하세요.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: '새 비밀번호가 일치하지 않습니다.',
    path: ['confirmPassword'],
  });

type PasswordFormValues = z.infer<typeof passwordSchema>;

export function PasswordSection() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      api.patch<{ message: string }>('/api/v1/me/password', data),
    onSuccess: () => {
      toast.success('비밀번호가 변경되었습니다.');
      reset();
    },
    onError: (err: Error) => {
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_CURRENT_PASSWORD') {
          toast.error('현재 비밀번호가 올바르지 않습니다.');
          return;
        }
        if (err.code === 'WEAK_PASSWORD') {
          toast.error('새 비밀번호가 보안 요구 사항을 충족하지 않습니다.');
          return;
        }
        toast.error(err.message);
        return;
      }
      toast.error('비밀번호 변경에 실패했습니다.');
    },
  });

  const onSubmit = (values: PasswordFormValues) => {
    mutation.mutate({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
  };

  return (
    <section>
      <h2 className="text-base font-semibold text-fg">비밀번호 변경</h2>
      <p className="mt-1 text-sm text-fg-muted">
        계정 비밀번호를 변경합니다. 변경 후 다시 로그인할 필요는 없습니다.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-4 space-y-4 rounded-lg border border-border bg-bg p-5"
        noValidate
      >
        <div className="space-y-2">
          <Label htmlFor="pw-current" required>현재 비밀번호</Label>
          <Input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.currentPassword || undefined}
            {...register('currentPassword')}
          />
          {errors.currentPassword && (
            <p className="text-xs text-danger">{errors.currentPassword.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="pw-new" required>새 비밀번호</Label>
          <Input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.newPassword || undefined}
            {...register('newPassword')}
          />
          {errors.newPassword && (
            <p className="text-xs text-danger">{errors.newPassword.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="pw-confirm" required>비밀번호 확인</Label>
          <Input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword || undefined}
            {...register('confirmPassword')}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-danger">{errors.confirmPassword.message}</p>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            변경
          </Button>
        </div>
      </form>
    </section>
  );
}
