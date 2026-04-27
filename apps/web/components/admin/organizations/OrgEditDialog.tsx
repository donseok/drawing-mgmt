'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle } from 'lucide-react';

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
  type AdminOrganization,
  type OrgEditValues,
  buildOrgPath,
  buildOrgTree,
  collectDescendantIds,
  orgEditSchema,
} from './types';

/**
 * R30 §A.6 — OrgEditDialog. `mode='create'` accepts a caller-supplied
 * `parentId` (null = top-level). `mode='edit'` opens with `target` and
 * presents the full org list as the parent select; the target itself and
 * its descendants are disabled to prevent cycles.
 *
 * Saving reaches the caller via `onSubmit` so the page can wire the
 * mutation. PM-DECISION-4: when `parentId` changes in edit-mode, we surface
 * a `<ConfirmDialog>` listing the move impact (children + users) before
 * actually submitting.
 */

export type OrgEditMode = 'create' | 'edit';

export interface OrgEditDialogProps {
  mode: OrgEditMode;
  /** Required when `mode === 'edit'`. */
  target?: AdminOrganization;
  /** Caller-provided when `mode === 'create'`. null = top-level. */
  parentId?: string | null;
  /** All organizations — used to build the parent select tree. */
  organizations: AdminOrganization[];
  open: boolean;
  onClose: () => void;
  onSubmit: (values: OrgEditValues) => Promise<void>;
}

/** Pre-order traversal that yields `{ id, label, depth, disabled }`. */
function buildParentOptions(
  organizations: AdminOrganization[],
  excludedIds: ReadonlySet<string>,
): Array<{ id: string; label: string; depth: number; disabled: boolean }> {
  const tree = buildOrgTree(organizations);
  const out: Array<{ id: string; label: string; depth: number; disabled: boolean }> = [];
  const walk = (
    nodes: ReturnType<typeof buildOrgTree>,
    depth: number,
  ): void => {
    for (const n of nodes) {
      out.push({
        id: n.id,
        label: n.name,
        depth,
        disabled: excludedIds.has(n.id),
      });
      walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}

const TOP_LEVEL_VALUE = '__top__';

export function OrgEditDialog({
  mode,
  target,
  parentId,
  organizations,
  open,
  onClose,
  onSubmit,
}: OrgEditDialogProps): JSX.Element {
  // For mode='edit', exclude self + descendants from parent options.
  const excluded = React.useMemo(() => {
    if (mode === 'edit' && target) {
      const desc = collectDescendantIds(organizations, target.id);
      desc.add(target.id);
      return desc;
    }
    return new Set<string>();
  }, [mode, organizations, target]);

  const parentOptions = React.useMemo(
    () => buildParentOptions(organizations, excluded),
    [organizations, excluded],
  );

  const defaultValues = React.useMemo<OrgEditValues>(() => {
    if (mode === 'edit' && target) {
      return {
        name: target.name,
        parentId: target.parentId,
        sortOrder: target.sortOrder,
      };
    }
    return {
      name: '',
      parentId: parentId ?? null,
      sortOrder: undefined,
    };
  }, [mode, target, parentId]);

  const form = useForm<OrgEditValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(orgEditSchema) as any,
    defaultValues,
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

  React.useEffect(() => {
    if (open) reset(defaultValues);
  }, [open, defaultValues, reset]);

  const watchedParentId = watch('parentId');
  const initialParentId = mode === 'edit' && target ? target.parentId : null;
  const parentChanged = mode === 'edit' && watchedParentId !== initialParentId;

  // ConfirmDialog for parent change (PM-DECISION-4).
  const [confirmMoveOpen, setConfirmMoveOpen] = React.useState(false);
  const [pendingValues, setPendingValues] = React.useState<OrgEditValues | null>(
    null,
  );

  const performSubmit = React.useCallback(
    async (values: OrgEditValues) => {
      try {
        // Normalize parentId: '' or undefined → null for top-level.
        const payload: OrgEditValues = {
          ...values,
          parentId: values.parentId === undefined ? null : values.parentId,
        };
        await onSubmit(payload);
        reset();
        onClose();
      } catch (err) {
        // Map server-side field errors into RHF inline errors.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const details = (err as any)?.details as
          | { fieldErrors?: Record<string, string[]> }
          | undefined;
        if (details?.fieldErrors) {
          for (const [field, msgs] of Object.entries(details.fieldErrors)) {
            const msg = msgs?.[0];
            if (msg) {
              setError(field as keyof OrgEditValues, {
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
            message: '같은 부모 안에서 이미 사용 중인 이름입니다.',
          });
          return;
        }
        // Unknown — surface upstream toast (handled by caller).
        throw err;
      }
    },
    [onSubmit, reset, onClose, setError],
  );

  const onValid = (values: OrgEditValues) => {
    if (parentChanged) {
      setPendingValues(values);
      setConfirmMoveOpen(true);
      return;
    }
    return performSubmit(values);
  };

  // Move impact strings for the confirm dialog.
  const moveImpact = React.useMemo(() => {
    if (mode !== 'edit' || !target) return null;
    const fromPath = buildOrgPath(organizations, target.id)
      .map((o) => o.name)
      .join(' / ');
    const targetParentId = watchedParentId;
    const toPath = (() => {
      if (!targetParentId) return target.name;
      const parentTrail = buildOrgPath(organizations, targetParentId)
        .map((o) => o.name)
        .join(' / ');
      return `${parentTrail} / ${target.name}`;
    })();
    return { fromPath, toPath };
  }, [mode, target, organizations, watchedParentId]);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? '조직 추가' : '조직 수정'}
            </DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? '신규 조직을 추가합니다. 같은 부모 안에서 이름이 중복되지 않도록 주의하세요.'
                : '조직 정보를 수정합니다. 부모를 변경하면 자식과 사용자가 함께 이동합니다.'}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmit(onValid)}
            className="space-y-4"
            noValidate
          >
            {/* name */}
            <div className="space-y-1.5">
              <Label htmlFor="org-name" required>
                조직 이름
              </Label>
              <Input
                id="org-name"
                placeholder="냉연 1팀"
                aria-invalid={!!errors.name || undefined}
                {...register('name')}
              />
              <p className="text-xs text-fg-subtle">
                1~50자. 같은 부모 안에서 중복 불가.
              </p>
              {errors.name ? (
                <p className="text-xs text-danger">{errors.name.message}</p>
              ) : null}
            </div>

            {/* parentId */}
            <div className="space-y-1.5">
              <Label htmlFor="org-parent">부모 조직</Label>
              <Select
                value={watchedParentId === null ? TOP_LEVEL_VALUE : (watchedParentId ?? TOP_LEVEL_VALUE)}
                onValueChange={(v) => {
                  setValue(
                    'parentId',
                    v === TOP_LEVEL_VALUE ? null : v,
                    { shouldDirty: true },
                  );
                }}
              >
                <SelectTrigger id="org-parent">
                  <SelectValue placeholder="부모 조직을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TOP_LEVEL_VALUE}>(없음 — 최상위)</SelectItem>
                  {parentOptions.map((opt) => (
                    <SelectItem
                      key={opt.id}
                      value={opt.id}
                      disabled={opt.disabled}
                    >
                      <span
                        style={{ paddingLeft: opt.depth * 12 }}
                        className={
                          opt.disabled ? 'text-fg-subtle line-through' : ''
                        }
                      >
                        {opt.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-fg-subtle">
                자기 자신 또는 자손은 부모로 선택할 수 없습니다.
              </p>
            </div>

            {/* sortOrder */}
            <div className="space-y-1.5">
              <Label htmlFor="org-sort">정렬 순서</Label>
              <Input
                id="org-sort"
                type="number"
                min={0}
                placeholder="비워두면 끝에 추가"
                aria-invalid={!!errors.sortOrder || undefined}
                {...register('sortOrder')}
              />
              <p className="text-xs text-fg-subtle">
                같은 부모 안 형제들의 정렬 순서. 비워두면 끝에 추가됩니다.
              </p>
              {errors.sortOrder ? (
                <p className="text-xs text-danger">
                  {errors.sortOrder.message as string}
                </p>
              ) : null}
            </div>

            {parentChanged && mode === 'edit' && target ? (
              <div
                role="alert"
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="space-y-1">
                    <p className="font-semibold text-amber-900 dark:text-amber-200">
                      부모 변경 안내
                    </p>
                    <p className="text-xs text-amber-900/90 dark:text-amber-100/90">
                      자식 조직 {target.childCount}개와 소속 사용자{' '}
                      {target.userCount}명이 함께 이동합니다. 저장 시 한 번 더
                      확인합니다.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

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

      <ConfirmDialog
        open={confirmMoveOpen}
        onOpenChange={(o) => {
          setConfirmMoveOpen(o);
          if (!o) setPendingValues(null);
        }}
        title="조직을 다음 부모로 이동합니다"
        description={
          target && moveImpact ? (
            <span className="space-y-1">
              <span className="block">현재: {moveImpact.fromPath}</span>
              <span className="block">변경: {moveImpact.toPath}</span>
              <span className="mt-2 block text-fg-muted">
                자식 조직 {target.childCount}개와 소속 사용자 {target.userCount}
                명이 함께 이동합니다.
              </span>
            </span>
          ) : (
            ''
          )
        }
        confirmText="이동 진행"
        cancelText="취소"
        variant="default"
        onConfirm={async () => {
          if (!pendingValues) return;
          await performSubmit(pendingValues);
          setConfirmMoveOpen(false);
          setPendingValues(null);
        }}
      />
    </>
  );
}
