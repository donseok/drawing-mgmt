'use client';

import * as React from 'react';
import { MoreVertical, Download, Copy, FolderInput, GitBranch, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface RowMenuRow {
  id: string;
  number: string;
  name: string;
}

interface RowMenuProps {
  row: RowMenuRow;
  onDownload?: (row: RowMenuRow) => void;
  onCopy?: (row: RowMenuRow) => void;
  onMove?: (row: RowMenuRow) => void;
  onCheckout?: (row: RowMenuRow) => void;
  onDelete?: (row: RowMenuRow) => void;
}

/**
 * RowMenu — per-row "⋮" dropdown for the object list (BUG-008).
 *
 * Each action is currently a stub that emits a `toast` + `console.log`.
 * Pass callbacks to override.
 */
export function RowMenu({
  row,
  onDownload,
  onCopy,
  onMove,
  onCheckout,
  onDelete,
}: RowMenuProps) {
  const handle = (
    label: string,
    cb: ((row: RowMenuRow) => void) | undefined,
    variant: 'info' | 'success' | 'warning' = 'info',
  ) => {
    if (cb) {
      cb(row);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[RowMenu] ${label}`, row);
    const message = `${label}: ${row.number}`;
    if (variant === 'warning') toast.warning(message);
    else if (variant === 'success') toast.success(message);
    else toast(message);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="행 메뉴"
          onClick={(e) => e.stopPropagation()}
          className="app-icon-button h-7 w-7"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        onClick={(e) => e.stopPropagation()}
        className="min-w-[10rem]"
      >
        <DropdownMenuItem onSelect={() => handle('다운로드', onDownload)}>
          <Download className="text-fg-muted" />
          다운로드
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handle('복사', onCopy)}>
          <Copy className="text-fg-muted" />
          복사
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handle('이동', onMove)}>
          <FolderInput className="text-fg-muted" />
          이동
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handle('체크아웃', onCheckout, 'success')}>
          <GitBranch className="text-fg-muted" />
          체크아웃
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={() => handle('삭제', onDelete, 'warning')}
        >
          <Trash2 />
          삭제
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
