'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

const profileSchema = z.object({
  fullName: z.string().min(1, '이름을 입력하세요.').max(100, '이름은 100자 이하여야 합니다.'),
  email: z.string().email('올바른 이메일을 입력하세요.').or(z.literal('')).optional(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

interface ProfileSectionProps {
  user: {
    username: string;
    fullName: string | null;
    email: string | null;
    role: string;
    organization?: { name: string } | null;
  };
}

export function ProfileSection({ user }: ProfileSectionProps) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: user.fullName ?? '',
      email: user.email ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: ProfileFormValues) =>
      api.patch('/api/v1/me', data),
    onSuccess: () => {
      toast.success('프로필이 저장되었습니다.');
      queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
    onError: (err: Error) => {
      const msg = err instanceof ApiError ? err.message : '프로필 저장에 실패했습니다.';
      toast.error(msg);
    },
  });

  const onSubmit = (values: ProfileFormValues) => {
    mutation.mutate(values);
  };

  return (
    <section>
      <h2 className="text-base font-semibold text-fg">프로필 정보</h2>
      <p className="mt-1 text-sm text-fg-muted">
        기본 사용자 정보를 확인하고 수정합니다.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-4 space-y-4 rounded-lg border border-border bg-bg p-5"
        noValidate
      >
        {/* Username — read only */}
        <div className="space-y-2">
          <Label htmlFor="profile-username">아이디</Label>
          <Input
            id="profile-username"
            value={user.username}
            disabled
            className="bg-bg-subtle"
          />
          <p className="text-xs text-fg-muted">아이디는 변경할 수 없습니다.</p>
        </div>

        {/* Full Name — editable */}
        <div className="space-y-2">
          <Label htmlFor="profile-fullName" required>이름</Label>
          <Input
            id="profile-fullName"
            autoComplete="name"
            aria-invalid={!!errors.fullName || undefined}
            {...register('fullName')}
          />
          {errors.fullName && (
            <p className="text-xs text-danger">{errors.fullName.message}</p>
          )}
        </div>

        {/* Email — editable */}
        <div className="space-y-2">
          <Label htmlFor="profile-email">이메일</Label>
          <Input
            id="profile-email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email || undefined}
            {...register('email')}
          />
          {errors.email && (
            <p className="text-xs text-danger">{errors.email.message}</p>
          )}
        </div>

        {/* Role — read only */}
        <div className="space-y-2">
          <Label htmlFor="profile-role">역할</Label>
          <Input
            id="profile-role"
            value={formatRole(user.role)}
            disabled
            className="bg-bg-subtle"
          />
        </div>

        {/* Organization — read only */}
        <div className="space-y-2">
          <Label htmlFor="profile-org">소속</Label>
          <Input
            id="profile-org"
            value={user.organization?.name ?? '소속 미지정'}
            disabled
            className="bg-bg-subtle"
          />
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={!isDirty || mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            저장
          </Button>
        </div>
      </form>
    </section>
  );
}

function formatRole(role: string): string {
  const map: Record<string, string> = {
    SUPER_ADMIN: '최고 관리자',
    ADMIN: '관리자',
    USER: '사용자',
    PARTNER: '협력사',
  };
  return map[role] ?? role;
}
