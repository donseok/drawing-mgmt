'use client';

import * as React from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

import type {
  AttributeItem,
  ClassItem,
  CreateAttributePayload,
  UpdateAttributePayload,
  UpdateClassPayload,
} from './types';
import { AttributeCard } from './AttributeCard';
import { AttributeDialog } from './AttributeDialog';

// ── Component ──────────────────────────────────────────────────────────────

interface ClassDetailPanelProps {
  classItem: ClassItem;
  onClose: () => void;
  onDeleted: () => void;
}

export function ClassDetailPanel({
  classItem,
  onClose,
  onDeleted,
}: ClassDetailPanelProps) {
  const queryClient = useQueryClient();

  // ── Editable basic info state ──────────────────────────────────────────
  const [isEditingInfo, setIsEditingInfo] = React.useState(false);
  const [editName, setEditName] = React.useState(classItem.name);
  const [editDescription, setEditDescription] = React.useState(
    classItem.description ?? '',
  );

  // Sync when classItem changes
  React.useEffect(() => {
    setEditName(classItem.name);
    setEditDescription(classItem.description ?? '');
    setIsEditingInfo(false);
  }, [classItem.id, classItem.name, classItem.description]);

  // ── Attributes query ───────────────────────────────────────────────────
  const {
    data: attributes,
    isLoading: attributesLoading,
  } = useQuery<AttributeItem[]>({
    queryKey: queryKeys.admin.classAttributes(classItem.id),
    queryFn: () =>
      api.get<AttributeItem[]>(
        `/api/v1/admin/classes/${classItem.id}/attributes`,
      ),
  });

  const sortedAttributes = React.useMemo(
    () =>
      attributes
        ? [...attributes].sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [attributes],
  );

  // ── Mutations ──────────────────────────────────────────────────────────

  // Update class
  const updateClassMutation = useMutation({
    mutationFn: (payload: UpdateClassPayload) =>
      api.patch(`/api/v1/admin/classes/${classItem.id}`, payload),
    onSuccess: () => {
      toast.success('자료유형이 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.classes() });
      setIsEditingInfo(false);
    },
    onError: (err: Error) => {
      const msg = err instanceof ApiError ? err.message : '수정에 실패했습니다.';
      toast.error(msg);
    },
  });

  // Delete class
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const deleteClassMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/admin/classes/${classItem.id}`),
    onSuccess: () => {
      toast.success('자료유형이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.classes() });
      onDeleted();
    },
    onError: (err: Error) => {
      const msg = err instanceof ApiError ? err.message : '삭제에 실패했습니다.';
      toast.error(msg);
    },
  });

  // Create attribute
  const [attrDialogOpen, setAttrDialogOpen] = React.useState(false);
  const [editingAttribute, setEditingAttribute] =
    React.useState<AttributeItem | null>(null);

  const createAttrMutation = useMutation({
    mutationFn: (payload: CreateAttributePayload) =>
      api.post(
        `/api/v1/admin/classes/${classItem.id}/attributes`,
        payload,
      ),
    onSuccess: () => {
      toast.success('속성이 추가되었습니다.');
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.classAttributes(classItem.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.classes() });
    },
    onError: (err: Error) => {
      const msg =
        err instanceof ApiError ? err.message : '속성 추가에 실패했습니다.';
      toast.error(msg);
    },
  });

  // Update attribute
  const updateAttrMutation = useMutation({
    mutationFn: ({
      attrId,
      ...payload
    }: UpdateAttributePayload & { attrId: string }) =>
      api.patch(
        `/api/v1/admin/classes/${classItem.id}/attributes/${attrId}`,
        payload,
      ),
    onSuccess: () => {
      toast.success('속성이 수정되었습니다.');
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.classAttributes(classItem.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.classes() });
    },
    onError: (err: Error) => {
      const msg =
        err instanceof ApiError ? err.message : '속성 수정에 실패했습니다.';
      toast.error(msg);
    },
  });

  // Delete attribute
  const [deleteAttrTarget, setDeleteAttrTarget] =
    React.useState<AttributeItem | null>(null);

  const deleteAttrMutation = useMutation({
    mutationFn: (attrId: string) =>
      api.delete(
        `/api/v1/admin/classes/${classItem.id}/attributes/${attrId}`,
      ),
    onSuccess: () => {
      toast.success('속성이 삭제되었습니다.');
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.classAttributes(classItem.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.classes() });
    },
    onError: (err: Error) => {
      const msg =
        err instanceof ApiError ? err.message : '속성 삭제에 실패했습니다.';
      toast.error(msg);
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleSaveInfo = () => {
    const payload: UpdateClassPayload = {};
    if (editName !== classItem.name) payload.name = editName;
    if (editDescription !== (classItem.description ?? ''))
      payload.description = editDescription;
    if (Object.keys(payload).length === 0) {
      setIsEditingInfo(false);
      return;
    }
    updateClassMutation.mutate(payload);
  };

  const handleCancelEdit = () => {
    setEditName(classItem.name);
    setEditDescription(classItem.description ?? '');
    setIsEditingInfo(false);
  };

  const handleAttrSubmit = async (values: {
    code: string;
    label: string;
    dataType: string;
    required: boolean;
    defaultValue?: string;
    comboItems?: string[];
    sortOrder?: number;
  }) => {
    if (editingAttribute) {
      await updateAttrMutation.mutateAsync({
        attrId: editingAttribute.id,
        label: values.label,
        required: values.required,
        defaultValue: values.defaultValue,
        comboItems: values.comboItems,
        sortOrder: values.sortOrder,
      });
    } else {
      await createAttrMutation.mutateAsync(
        values as CreateAttributePayload,
      );
    }
  };

  const canDelete = classItem.objectCount === 0;

  return (
    <>
      <aside className="flex w-[400px] shrink-0 flex-col overflow-hidden border-l border-border bg-bg">
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">자료유형 상세</h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            aria-label="패널 닫기"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Basic info section */}
          <div className="border-b border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase text-fg-muted">
                기본 정보
              </span>
              {!isEditingInfo ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setIsEditingInfo(true)}
                >
                  <Pencil className="h-3 w-3" />
                  편집
                </Button>
              ) : (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={handleCancelEdit}
                    disabled={updateClassMutation.isPending}
                  >
                    취소
                  </Button>
                  <Button
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={handleSaveInfo}
                    disabled={updateClassMutation.isPending}
                  >
                    <Save className="h-3 w-3" />
                    {updateClassMutation.isPending ? '저장 중...' : '저장'}
                  </Button>
                </div>
              )}
            </div>

            <div className="mt-3 space-y-3">
              {/* Code (read-only) */}
              <div className="space-y-1">
                <Label className="text-xs text-fg-subtle">코드</Label>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {classItem.code}
                </Badge>
              </div>

              {/* Name */}
              <div className="space-y-1">
                <Label htmlFor="detail-name" className="text-xs text-fg-subtle">
                  명칭
                </Label>
                {isEditingInfo ? (
                  <Input
                    id="detail-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 text-sm"
                  />
                ) : (
                  <p className="text-sm text-fg">{classItem.name}</p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1">
                <Label
                  htmlFor="detail-description"
                  className="text-xs text-fg-subtle"
                >
                  설명
                </Label>
                {isEditingInfo ? (
                  <Textarea
                    id="detail-description"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={3}
                    className="text-sm"
                  />
                ) : (
                  <p className="text-sm text-fg-muted">
                    {classItem.description || '-'}
                  </p>
                )}
              </div>

              {/* Stats */}
              <div className="flex gap-4 pt-1">
                <div>
                  <span className="text-xs text-fg-subtle">속성 수</span>
                  <p className="text-sm font-medium tabular-nums text-fg">
                    {sortedAttributes.length}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-fg-subtle">사용 자료</span>
                  <p className="text-sm font-medium tabular-nums text-fg">
                    {classItem.objectCount}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Attributes section */}
          <div className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase text-fg-muted">
                속성 목록
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setEditingAttribute(null);
                  setAttrDialogOpen(true);
                }}
              >
                <Plus className="h-3 w-3" />
                속성 추가
              </Button>
            </div>

            <div className="mt-3 space-y-2">
              {attributesLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))
              ) : sortedAttributes.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-fg-muted">
                    등록된 속성이 없습니다.
                  </p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    속성 추가 버튼을 눌러 시작하세요.
                  </p>
                </div>
              ) : (
                sortedAttributes.map((attr) => (
                  <AttributeCard
                    key={attr.id}
                    attribute={attr}
                    onEdit={(a) => {
                      setEditingAttribute(a);
                      setAttrDialogOpen(true);
                    }}
                    onDelete={(a) => setDeleteAttrTarget(a)}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer with delete button */}
        <div className="border-t border-border p-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block w-full" tabIndex={canDelete ? -1 : 0}>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-danger hover:text-danger hover:bg-danger/5"
                  disabled={!canDelete}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  자료유형 삭제
                </Button>
              </span>
            </TooltipTrigger>
            {!canDelete && (
              <TooltipContent>
                이 자료유형을 사용 중인 자료가 {classItem.objectCount}건
                있어 삭제할 수 없습니다.
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </aside>

      {/* Attribute create/edit dialog */}
      <AttributeDialog
        open={attrDialogOpen}
        onOpenChange={setAttrDialogOpen}
        editingAttribute={editingAttribute}
        onSubmit={handleAttrSubmit}
      />

      {/* Delete class confirm dialog */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="자료유형을 삭제하시겠습니까?"
        description={`"${classItem.name}" (${classItem.code}) 자료유형과 모든 속성 정의가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`}
        confirmText="삭제"
        variant="destructive"
        disabled={deleteClassMutation.isPending}
        onConfirm={async () => {
          await deleteClassMutation.mutateAsync();
          setDeleteOpen(false);
        }}
      />

      {/* Delete attribute confirm dialog */}
      <ConfirmDialog
        open={!!deleteAttrTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteAttrTarget(null);
        }}
        title="속성을 삭제하시겠습니까?"
        description={
          deleteAttrTarget
            ? `"${deleteAttrTarget.label}" (${deleteAttrTarget.code}) 속성이 삭제됩니다.`
            : ''
        }
        confirmText="삭제"
        variant="destructive"
        disabled={deleteAttrMutation.isPending}
        onConfirm={async () => {
          if (deleteAttrTarget) {
            await deleteAttrMutation.mutateAsync(deleteAttrTarget.id);
            setDeleteAttrTarget(null);
          }
        }}
      />
    </>
  );
}
