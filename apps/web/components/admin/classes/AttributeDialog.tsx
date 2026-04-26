'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, X } from 'lucide-react';

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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AttributeItem, DataType } from './types';
import { DATA_TYPES, DATA_TYPE_CONFIG } from './types';

// ── Zod schema ─────────────────────────────────────────────────────────────

const attributeSchema = z.object({
  code: z
    .string()
    .min(1, '코드를 입력하세요.')
    .max(30, '코드는 30자 이내로 입력하세요.')
    .regex(
      /^[A-Z0-9_-]+$/,
      '대문자 영숫자, 밑줄(_), 하이픈(-)만 사용할 수 있습니다.',
    ),
  label: z
    .string()
    .min(1, '라벨을 입력하세요.')
    .max(100, '라벨은 100자 이내로 입력하세요.'),
  dataType: z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'COMBO'] as const, {
    required_error: '데이터 타입을 선택하세요.',
  }),
  required: z.boolean(),
  defaultValue: z.string().optional().or(z.literal('')),
  comboItems: z.array(z.string()).optional(),
  sortOrder: z.coerce
    .number()
    .int('정수를 입력하세요.')
    .min(0, '0 이상이어야 합니다.')
    .optional(),
});

type AttributeFormValues = z.infer<typeof attributeSchema>;

// ── Component ──────────────────────────────────────────────────────────────

interface AttributeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, we are in edit mode. */
  editingAttribute: AttributeItem | null;
  onSubmit: (values: AttributeFormValues) => Promise<void>;
}

export function AttributeDialog({
  open,
  onOpenChange,
  editingAttribute,
  onSubmit,
}: AttributeDialogProps) {
  const isEditing = !!editingAttribute;

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AttributeFormValues>({
    resolver: zodResolver(attributeSchema),
    defaultValues: {
      code: '',
      label: '',
      dataType: 'TEXT',
      required: false,
      defaultValue: '',
      comboItems: [],
      sortOrder: 0,
    },
  });

  const dataType = watch('dataType');
  const comboItems = watch('comboItems') ?? [];

  // Force code uppercase on create
  const codeValue = watch('code');
  React.useEffect(() => {
    if (!isEditing) {
      const upper = (codeValue ?? '').toUpperCase();
      if (upper !== codeValue) {
        setValue('code', upper, { shouldValidate: false });
      }
    }
  }, [codeValue, setValue, isEditing]);

  // Reset form when dialog opens or editing attribute changes
  React.useEffect(() => {
    if (open) {
      if (editingAttribute) {
        reset({
          code: editingAttribute.code,
          label: editingAttribute.label,
          dataType: editingAttribute.dataType,
          required: editingAttribute.required,
          defaultValue: editingAttribute.defaultValue ?? '',
          comboItems: editingAttribute.comboItems ?? [],
          sortOrder: editingAttribute.sortOrder,
        });
      } else {
        reset({
          code: '',
          label: '',
          dataType: 'TEXT',
          required: false,
          defaultValue: '',
          comboItems: [],
          sortOrder: 0,
        });
      }
    }
  }, [open, editingAttribute, reset]);

  // ── Combo items management ─────────────────────────────────────────────
  const [newComboItem, setNewComboItem] = React.useState('');

  const addComboItem = () => {
    const trimmed = newComboItem.trim();
    if (!trimmed) return;
    if (comboItems.includes(trimmed)) return;
    setValue('comboItems', [...comboItems, trimmed]);
    setNewComboItem('');
  };

  const removeComboItem = (index: number) => {
    setValue(
      'comboItems',
      comboItems.filter((_, i) => i !== index),
    );
  };

  const handleFormSubmit = handleSubmit(async (values) => {
    await onSubmit({
      ...values,
      defaultValue: values.defaultValue || undefined,
      comboItems:
        values.dataType === 'COMBO' && values.comboItems && values.comboItems.length > 0
          ? values.comboItems
          : undefined,
      sortOrder: values.sortOrder ?? undefined,
    });
    reset();
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? '속성 편집' : '새 속성 추가'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? '속성의 라벨, 필수 여부, 기본값 등을 변경합니다. 코드와 데이터 타입은 변경할 수 없습니다.'
              : '새 속성의 코드와 데이터 타입은 생성 후 변경할 수 없습니다.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleFormSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Code */}
            <div className="space-y-1.5">
              <Label htmlFor="attr-code" required>
                코드
              </Label>
              <Input
                id="attr-code"
                placeholder="DRAWING_NO"
                className="font-mono uppercase"
                disabled={isEditing}
                {...register('code')}
              />
              {errors.code && (
                <p className="text-xs text-danger">{errors.code.message}</p>
              )}
            </div>

            {/* Data Type */}
            <div className="space-y-1.5">
              <Label htmlFor="attr-dataType" required>
                데이터 타입
              </Label>
              <Controller
                name="dataType"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(val) => field.onChange(val as DataType)}
                    disabled={isEditing}
                  >
                    <SelectTrigger id="attr-dataType">
                      <SelectValue placeholder="타입 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {DATA_TYPES.map((dt) => (
                        <SelectItem key={dt} value={dt}>
                          <span className="flex items-center gap-2">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${DATA_TYPE_CONFIG[dt].className}`}
                            />
                            {DATA_TYPE_CONFIG[dt].label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.dataType && (
                <p className="text-xs text-danger">{errors.dataType.message}</p>
              )}
            </div>
          </div>

          {/* Label */}
          <div className="space-y-1.5">
            <Label htmlFor="attr-label" required>
              라벨
            </Label>
            <Input
              id="attr-label"
              placeholder="도면번호"
              {...register('label')}
            />
            {errors.label && (
              <p className="text-xs text-danger">{errors.label.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Required */}
            <div className="space-y-1.5">
              <Label>필수 여부</Label>
              <Controller
                name="required"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox
                      id="attr-required"
                      checked={field.value}
                      onCheckedChange={(checked) =>
                        field.onChange(checked === true)
                      }
                    />
                    <label
                      htmlFor="attr-required"
                      className="text-sm text-fg-muted cursor-pointer select-none"
                    >
                      필수 입력
                    </label>
                  </div>
                )}
              />
            </div>

            {/* Sort Order */}
            <div className="space-y-1.5">
              <Label htmlFor="attr-sortOrder">정렬 순서</Label>
              <Input
                id="attr-sortOrder"
                type="number"
                min={0}
                className="tabular-nums"
                {...register('sortOrder')}
              />
              {errors.sortOrder && (
                <p className="text-xs text-danger">{errors.sortOrder.message}</p>
              )}
            </div>
          </div>

          {/* Default Value */}
          <div className="space-y-1.5">
            <Label htmlFor="attr-defaultValue">기본값</Label>
            <Input
              id="attr-defaultValue"
              placeholder={
                dataType === 'BOOLEAN'
                  ? 'true 또는 false'
                  : dataType === 'NUMBER'
                    ? '0'
                    : dataType === 'DATE'
                      ? 'YYYY-MM-DD'
                      : '기본값 입력'
              }
              {...register('defaultValue')}
            />
          </div>

          {/* Combo Items (only when dataType is COMBO) */}
          {dataType === 'COMBO' && (
            <div className="space-y-1.5">
              <Label>선택 항목</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="새 항목 입력"
                  value={newComboItem}
                  onChange={(e) => setNewComboItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addComboItem();
                    }
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={addComboItem}
                  aria-label="항목 추가"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {comboItems.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {comboItems.map((item, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-md bg-bg-muted px-2 py-1 text-xs text-fg"
                    >
                      {item}
                      <button
                        type="button"
                        onClick={() => removeComboItem(idx)}
                        className="ml-0.5 rounded-sm p-0.5 hover:bg-bg-subtle"
                        aria-label={`${item} 제거`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {comboItems.length === 0 && (
                <p className="text-xs text-fg-subtle">
                  Enter 또는 + 버튼으로 항목을 추가하세요.
                </p>
              )}
            </div>
          )}

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
              {isSubmitting
                ? isEditing
                  ? '저장 중...'
                  : '추가 중...'
                : isEditing
                  ? '저장'
                  : '추가'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
