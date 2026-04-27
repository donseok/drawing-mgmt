'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

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

import {
  type AdminGroupListItem,
  type GroupEditValues,
  groupEditSchema,
} from './types';

/**
 * R30 §B.5 — GroupEditDialog. Two fields: name (required, unique) +
 * description (≤200). PM-DECISION-7 default: do NOT enforce a regex on
 * group names (helper-text only). Server-side conflict (409 E_CONFLICT)
 * surfaces as an inline error on `name`.
 */
export type GroupEditMode = 'create' | 'edit';

export interface GroupEditDialogProps {
  mode: GroupEditMode;
  target?: AdminGroupListItem;
  open: boolean;
  onClose: () => void;
  onSubmit: (values: GroupEditValues) => Promise<void>;
}

export function GroupEditDialog({
  mode,
  target,
  open,
  onClose,
  onSubmit,
}: GroupEditDialogProps): JSX.Element {
  const defaultValues = React.useMemo<GroupEditValues>(() => {
    if (mode === 'edit' && target) {
      return {
        name: target.name,
        description: target.description ?? undefined,
      };
    }
    return { name: '', description: undefined };
  }, [mode, target]);

  const form = useForm<GroupEditValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(groupEditSchema) as any,
    defaultValues,
  });
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  React.useEffect(() => {
    if (open) reset(defaultValues);
  }, [open, defaultValues, reset]);

  const onValid = async (values: GroupEditValues) => {
    try {
      await onSubmit(values);
      reset();
      onClose();
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details = (err as any)?.details as
        | { fieldErrors?: Record<string, string[]> }
        | undefined;
      if (details?.fieldErrors) {
        for (const [field, msgs] of Object.entries(details.fieldErrors)) {
          const msg = msgs?.[0];
          if (msg) {
            setError(field as keyof GroupEditValues, {
              type: 'server',
              message: msg,
            });
          }
        }
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (err as any)?.code;
      if (code === 'E_CONFLICT') {
        setError('name', {
          type: 'server',
          message: '이미 사용 중인 그룹명입니다.',
        });
        return;
      }
      throw err;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? '그룹 추가' : '그룹 수정'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? '신규 그룹을 추가합니다. 이름은 시스템 전역에서 고유해야 합니다.'
              : '그룹 정보를 수정합니다. 멤버십은 매트릭스에서 따로 편집하세요.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="group-name" required>
              그룹 이름
            </Label>
            <Input
              id="group-name"
              placeholder="drawing-editors"
              className="font-mono"
              aria-invalid={!!errors.name || undefined}
              {...register('name')}
            />
            <p className="text-xs text-fg-subtle">
              1~50자. 영문 소문자/숫자/`-`/`_` 권장. 시스템 전역 unique.
            </p>
            {errors.name ? (
              <p className="text-xs text-danger">{errors.name.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="group-desc">설명</Label>
            <Textarea
              id="group-desc"
              placeholder="설계자 도면 편집 권한 그룹"
              rows={3}
              aria-invalid={!!errors.description || undefined}
              {...register('description')}
            />
            <p className="text-xs text-fg-subtle">
              1~200자. 화면 list에 함께 표시됩니다.
            </p>
            {errors.description ? (
              <p className="text-xs text-danger">{errors.description.message}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
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
  );
}
