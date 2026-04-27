'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Eye, EyeOff } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';

import {
  userCreateSchema,
  userEditSchema,
  type AdminUserListItem,
  type EmploymentType,
  type SecurityLevel,
  type UserCreateValues,
  type UserEditValues,
  type UserRole,
} from './types';

/**
 * R29 §A.6 — UserFormDialog. `mode='create'` shows the password field and
 * a free username; `mode='edit'` reuses the same layout but disables
 * username/password and surfaces the self-demotion warning when the admin
 * lowers their own role.
 *
 * Submission is delegated via `onSubmit` so the caller (page) wires the
 * mutation and decides what `invalidateQueries` runs on success. The dialog
 * surfaces server-side field errors via `setFieldError`.
 */

export type UserFormMode = 'create' | 'edit';

export interface UserFormDialogProps {
  mode: UserFormMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required when `mode === 'edit'`. */
  initial?: AdminUserListItem;
  currentSelfId: string;
  currentSelfRole: UserRole;
  organizations: Array<{ id: string; name: string }>;
  onSubmit: (values: UserCreateValues | UserEditValues) => Promise<void>;
}

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'SUPER_ADMIN', label: '슈퍼관리자' },
  { value: 'ADMIN', label: '관리자' },
  { value: 'USER', label: '사용자' },
  { value: 'PARTNER', label: '협력업체' },
];

const EMPLOYMENT_OPTIONS: Array<{ value: EmploymentType; label: string }> = [
  { value: 'ACTIVE', label: '재직' },
  { value: 'RETIRED', label: '퇴직' },
  { value: 'PARTNER', label: '협력' },
];

const SECURITY_OPTIONS: SecurityLevel[] = [1, 2, 3, 4, 5];

export function UserFormDialog({
  mode,
  open,
  onOpenChange,
  initial,
  currentSelfId,
  currentSelfRole,
  organizations,
  onSubmit,
}: UserFormDialogProps): JSX.Element {
  // Distinct schemas; share most fields. RHF doesn't support runtime swap
  // gracefully so we just instantiate the right one per mode.
  const schema = mode === 'create' ? userCreateSchema : userEditSchema;

  const defaultValues = React.useMemo(() => {
    if (mode === 'edit' && initial) {
      return {
        username: initial.username,
        fullName: initial.fullName,
        email: initial.email ?? '',
        organizationId: initial.organizationId ?? '',
        role: initial.role,
        employmentType: initial.employmentType,
        securityLevel: initial.securityLevel,
      } satisfies UserEditValues;
    }
    return {
      username: '',
      fullName: '',
      email: '',
      organizationId: '',
      role: 'USER' as UserRole,
      employmentType: 'ACTIVE' as EmploymentType,
      securityLevel: 5 as SecurityLevel,
      password: '',
    } satisfies UserCreateValues;
  }, [mode, initial]);

  // Cast — the resolver is correct per-mode but TS can't follow the union.
  const form = useForm<UserCreateValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: defaultValues as UserCreateValues,
  });
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  // Reset whenever we open or switch target — RHF retains state across
  // unmounts otherwise and sneakily preserves values from prior dialogs.
  React.useEffect(() => {
    if (open) reset(defaultValues as UserCreateValues);
  }, [open, defaultValues, reset]);

  const [showPassword, setShowPassword] = React.useState(false);
  const [confirmDemotionOpen, setConfirmDemotionOpen] = React.useState(false);
  const [pendingValues, setPendingValues] = React.useState<UserCreateValues | null>(
    null,
  );

  // Self-demotion banner: edit mode + self target + role changed to a lower one.
  const watchedRole = watch('role');
  const isEditingSelf = mode === 'edit' && initial?.id === currentSelfId;
  const selfDemotion =
    isEditingSelf && initial && watchedRole !== initial.role;

  // SUPER_ADMIN role option visibility: only when self is SUPER_ADMIN, regardless
  // of mode. PM-DECISION: ADMIN cannot create or promote to SUPER_ADMIN.
  const visibleRoles = ROLE_OPTIONS.filter((r) => {
    if (r.value === 'SUPER_ADMIN' && currentSelfRole !== 'SUPER_ADMIN') return false;
    return true;
  });

  const performSubmit = React.useCallback(
    async (values: UserCreateValues) => {
      try {
        // Strip empty strings (the schema transforms most into undefined,
        // but if the user typed and cleared, we want PATCH semantics).
        const payload: UserCreateValues = {
          ...values,
          email: values.email && values.email.length > 0 ? values.email : undefined,
          organizationId:
            values.organizationId && values.organizationId.length > 0
              ? values.organizationId
              : undefined,
        };
        await onSubmit(payload);
        reset();
        onOpenChange(false);
      } catch (err) {
        // Map server-side field errors into RHF inline errors. The ApiError
        // payload uses Zod's `flatten()`, so look for `details.fieldErrors`.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const details = (err as any)?.details as
          | { fieldErrors?: Record<string, string[]> }
          | undefined;
        if (details?.fieldErrors) {
          for (const [field, msgs] of Object.entries(details.fieldErrors)) {
            const msg = msgs?.[0];
            if (msg) {
              setError(field as keyof UserCreateValues, {
                type: 'server',
                message: msg,
              });
            }
          }
          return;
        }
        // 409 username conflict — common enough to map by code.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const code = (err as any)?.code;
        if (code === 'E_CONFLICT') {
          setError('username', {
            type: 'server',
            message: '이미 사용 중인 사용자명입니다.',
          });
          return;
        }
        // Unknown error — let the caller's toast surface it.
        throw err;
      }
    },
    [onSubmit, reset, onOpenChange, setError],
  );

  const onValid = (values: UserCreateValues) => {
    if (selfDemotion) {
      setPendingValues(values);
      setConfirmDemotionOpen(true);
      return;
    }
    return performSubmit(values);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? '사용자 추가' : '사용자 수정'}
            </DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? '신규 계정을 등록합니다. 임시 비밀번호는 사용자에게 안전한 채널로 전달하세요.'
                : '계정 정보를 수정합니다. 비밀번호는 별도 [비밀번호 리셋] 동작으로 변경하세요.'}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmit(onValid)}
            className="space-y-4"
            noValidate
          >
            {/* username */}
            <div className="space-y-1.5">
              <Label htmlFor="user-username" required>
                사용자명
              </Label>
              <Input
                id="user-username"
                disabled={mode === 'edit'}
                placeholder="park.yh"
                className="font-mono"
                aria-invalid={!!errors.username || undefined}
                {...register('username')}
              />
              <p className="text-xs text-fg-subtle">
                영문 소문자/숫자/`.`/`_`/`-`만 사용. 8~32자.
              </p>
              {errors.username && (
                <p className="text-xs text-danger">{errors.username.message}</p>
              )}
            </div>

            {/* fullName */}
            <div className="space-y-1.5">
              <Label htmlFor="user-fullname" required>
                이름
              </Label>
              <Input
                id="user-fullname"
                placeholder="박영호"
                aria-invalid={!!errors.fullName || undefined}
                {...register('fullName')}
              />
              {errors.fullName && (
                <p className="text-xs text-danger">{errors.fullName.message}</p>
              )}
            </div>

            {/* email */}
            <div className="space-y-1.5">
              <Label htmlFor="user-email">이메일</Label>
              <Input
                id="user-email"
                type="email"
                placeholder="park.yh@dkc.co.kr"
                aria-invalid={!!errors.email || undefined}
                {...register('email')}
              />
              {errors.email && (
                <p className="text-xs text-danger">{errors.email.message}</p>
              )}
            </div>

            {/* organization + role grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="user-org">조직</Label>
                <Select
                  value={watch('organizationId') ?? ''}
                  onValueChange={(v) =>
                    setValue('organizationId', v === '__none__' ? '' : v, {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger id="user-org">
                    <SelectValue placeholder="조직을 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— 미배정</SelectItem>
                    {organizations.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-role" required>
                  역할
                </Label>
                <Select
                  value={watch('role')}
                  onValueChange={(v) =>
                    setValue('role', v as UserRole, { shouldDirty: true })
                  }
                >
                  <SelectTrigger id="user-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleRoles.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* employment + security grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="user-employment" required>
                  재직 형태
                </Label>
                <Select
                  value={watch('employmentType')}
                  onValueChange={(v) =>
                    setValue('employmentType', v as EmploymentType, {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger id="user-employment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_OPTIONS.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-seclevel" required>
                  보안등급
                </Label>
                <Select
                  value={String(watch('securityLevel') ?? 5)}
                  onValueChange={(v) =>
                    setValue('securityLevel', Number(v) as SecurityLevel, {
                      shouldDirty: true,
                    })
                  }
                >
                  <SelectTrigger id="user-seclevel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SECURITY_OPTIONS.map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s} ({s === 1 ? '최고' : s === 5 ? '최저' : '중간'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* password — create only */}
            {mode === 'create' && (
              <div className="space-y-1.5">
                <Label htmlFor="user-password" required>
                  비밀번호
                </Label>
                <div className="relative">
                  <Input
                    id="user-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="8자 이상"
                    aria-invalid={!!errors.password || undefined}
                    {...register('password')}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-fg-muted hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-fg-subtle">
                  사용자에게 별도 채널로 전달하세요. 8자 이상.
                </p>
                {errors.password && (
                  <p className="text-xs text-danger">{errors.password.message}</p>
                )}
              </div>
            )}

            {/* Self-demotion warning banner */}
            {selfDemotion && initial ? (
              <div
                role="alert"
                aria-live="assertive"
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="space-y-1">
                    <p className="font-semibold text-amber-900 dark:text-amber-200">
                      본인 강등 경고
                    </p>
                    <p className="text-xs text-amber-900/90 dark:text-amber-100/90">
                      저장 후 본인의 역할이{' '}
                      <span className="font-mono">
                        {initial.role} → {watchedRole}
                      </span>{' '}
                      으로 변경됩니다. 관리자 화면에 접근할 수 없게 될 수 있습니다.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

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
                {isSubmitting ? '저장 중...' : '저장'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Self-demotion confirm — second gate. */}
      <ConfirmDialog
        open={confirmDemotionOpen}
        onOpenChange={(o) => {
          setConfirmDemotionOpen(o);
          if (!o) setPendingValues(null);
        }}
        title="본인 계정을 강등합니다"
        description={
          initial
            ? `현재 역할: ${initial.role} → 변경 역할: ${watchedRole}. 저장 후 즉시 관리자 화면에서 자동 redirect 됩니다.`
            : ''
        }
        confirmText="강등 진행"
        cancelText="취소"
        variant="destructive"
        onConfirm={async () => {
          if (!pendingValues) return;
          await performSubmit(pendingValues);
          setConfirmDemotionOpen(false);
          setPendingValues(null);
        }}
      />
    </>
  );
}
