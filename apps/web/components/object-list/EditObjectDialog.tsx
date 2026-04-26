'use client';

/**
 * EditObjectDialog — name + description + securityLevel edit form.
 *
 * R23 — wires the action-bar "수정" button (BUG-06) to the existing
 * PATCH /api/v1/objects/:id endpoint. The BE enforces the lock-owner gate
 * (CHECKED_OUT + isLocker) so the dialog can stay open and surface the BE
 * error inline if the state changed since the page rendered.
 *
 * Attribute editing (자료유형 속성) is not handled here — those are class-
 * specific and live in their own R24 candidate.
 */

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

const SECURITY_LEVELS = [
  { value: 1, label: '1 — 공개' },
  { value: 2, label: '2 — 사내' },
  { value: 3, label: '3 — 부서' },
  { value: 4, label: '4 — 제한' },
  { value: 5, label: '5 — 기밀' },
] as const;

export interface EditObjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objectId: string;
  initial: {
    name: string;
    description: string | null;
    securityLevel: number;
  };
}

export function EditObjectDialog({
  open,
  onOpenChange,
  objectId,
  initial,
}: EditObjectDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(initial.name);
  const [description, setDescription] = React.useState(initial.description ?? '');
  const [securityLevel, setSecurityLevel] = React.useState(initial.securityLevel);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName(initial.name);
      setDescription(initial.description ?? '');
      setSecurityLevel(initial.securityLevel);
      setErr(null);
    }
  }, [open, initial.name, initial.description, initial.securityLevel]);

  const mutation = useMutation<
    unknown,
    ApiError,
    { name: string; description: string | null; securityLevel: number }
  >({
    mutationFn: (vars) =>
      api.patch(`/api/v1/objects/${objectId}`, {
        name: vars.name,
        description: vars.description,
        securityLevel: vars.securityLevel,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.detail(objectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.objects.activity(objectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.objects.all() });
      toast.success('자료를 수정했습니다.');
      onOpenChange(false);
    },
    onError: (e) => {
      setErr(e.message);
    },
  });

  const submit = () => {
    setErr(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setErr('자료명을 입력하세요.');
      return;
    }
    if (trimmed.length > 200) {
      setErr('자료명은 200자 이내로 입력하세요.');
      return;
    }
    const trimmedDesc = description.trim();
    if (trimmedDesc.length > 2000) {
      setErr('설명은 2000자 이내로 입력하세요.');
      return;
    }
    mutation.mutate({
      name: trimmed,
      description: trimmedDesc.length === 0 ? null : trimmedDesc,
      securityLevel,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>자료 수정</DialogTitle>
          <DialogDescription>
            체크아웃 상태에서만 편집할 수 있습니다. 변경 후 체크인 시 새 버전으로
            기록됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="app-kicker mb-1 block">자료명</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              autoFocus
              className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block">
            <span className="app-kicker mb-1 block">설명</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="자료에 대한 간단한 설명 (선택)"
              className="w-full rounded-md border border-border bg-bg-subtle p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block">
            <span className="app-kicker mb-1 block">보안등급</span>
            <select
              value={securityLevel}
              onChange={(e) => setSecurityLevel(Number(e.target.value))}
              className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {SECURITY_LEVELS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {err ? (
            <p role="alert" className="text-xs text-danger">
              {err}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
            className="app-action-button h-9"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={mutation.isPending}
            className="app-action-button-primary h-9"
          >
            {mutation.isPending ? '저장 중…' : '저장'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
