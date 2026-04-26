'use client';

import * as React from 'react';
import { Pencil, Trash2, GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { AttributeItem } from './types';
import { DATA_TYPE_CONFIG } from './types';

interface AttributeCardProps {
  attribute: AttributeItem;
  onEdit: (attr: AttributeItem) => void;
  onDelete: (attr: AttributeItem) => void;
}

export function AttributeCard({ attribute, onEdit, onDelete }: AttributeCardProps) {
  const dtConfig = DATA_TYPE_CONFIG[attribute.dataType];

  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-lg border border-border bg-bg px-3 py-2.5',
        'transition-colors hover:border-border-strong hover:bg-bg-subtle',
      )}
    >
      {/* Drag handle placeholder (visual only for now) */}
      <GripVertical className="h-4 w-4 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] font-medium text-fg">
            {attribute.code}
          </span>
          <Badge
            variant="secondary"
            className={cn('text-[10px] font-medium', dtConfig.className)}
          >
            {dtConfig.label}
          </Badge>
          {attribute.required && (
            <Badge variant="outline" className="text-[10px] text-danger border-danger/30">
              필수
            </Badge>
          )}
        </div>
        <span className="text-sm text-fg-muted">{attribute.label}</span>
        {attribute.defaultValue && (
          <span className="text-xs text-fg-subtle">
            기본값: {attribute.defaultValue}
          </span>
        )}
        {attribute.dataType === 'COMBO' && attribute.comboItems && attribute.comboItems.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {attribute.comboItems.map((item, idx) => (
              <span
                key={idx}
                className="rounded bg-bg-muted px-1.5 py-0.5 text-[10px] text-fg-muted"
              >
                {item}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Sort order */}
      <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
        #{attribute.sortOrder}
      </span>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onEdit(attribute)}
              aria-label={`${attribute.code} 편집`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>편집</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-danger hover:text-danger"
              onClick={() => onDelete(attribute)}
              aria-label={`${attribute.code} 삭제`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>삭제</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
