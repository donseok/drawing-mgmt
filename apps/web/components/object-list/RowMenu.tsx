'use client';

import * as React from 'react';
import {
  MoreVertical,
  Download,
  Copy,
  FolderInput,
  GitBranch,
  CheckCircle2,
  Send,
  Undo2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Minimum row payload the menu needs to decide which mutation actions are
 * available. We intentionally include `state` and `lockedById` so the menu
 * can self-derive enable/disable rules from the documented state machine
 * (api_contract.md SIDE-C):
 *   - CHECKED_OUT(self) → checkin / cancelCheckout enabled
 *   - CHECKED_OUT(other) → all mutation actions disabled
 *   - {NEW, CHECKED_IN, APPROVED} → checkout enabled
 *   - CHECKED_IN → release (결재상신) enabled
 *   - IN_APPROVAL → all mutation actions disabled
 *   - delete: state ≠ IN_APPROVAL (admin gating lands in R3c)
 */
export interface RowMenuRow {
  id: string;
  number: string;
  name: string;
  state:
    | 'NEW'
    | 'CHECKED_OUT'
    | 'CHECKED_IN'
    | 'IN_APPROVAL'
    | 'APPROVED'
    | 'DELETED';
  /** User ID currently holding the lock, or null when unlocked. */
  lockedById?: string | null;
}

interface RowMenuProps {
  row: RowMenuRow;
  /** Signed-in user id (from `useQuery(queryKeys.me())`). Pass undefined while loading. */
  meId?: string;
  // Stub callbacks (still wired through `handle()` for now).
  onDownload?: (row: RowMenuRow) => void;
  onCopy?: (row: RowMenuRow) => void;
  onMove?: (row: RowMenuRow) => void;
  // Mutation callbacks (parent runs the React Query mutation).
  onCheckout?: (row: RowMenuRow) => void;
  onCheckin?: (row: RowMenuRow) => void;
  onCancelCheckout?: (row: RowMenuRow) => void;
  onRelease?: (row: RowMenuRow) => void;
  onDelete?: (row: RowMenuRow) => void;
}

/**
 * RowMenu — per-row "⋮" dropdown for the object list (BUG-008).
 *
 * Menu items branch on row.state + lockedById vs meId. Callers wire each
 * mutation to a React Query mutation (search/page.tsx). Items without a
 * callback fall back to a console.log + toast stub for the read-only
 * actions (download/copy/move).
 */
export function RowMenu({
  row,
  meId,
  onDownload,
  onCopy,
  onMove,
  onCheckout,
  onCheckin,
  onCancelCheckout,
  onRelease,
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

  // ── State-machine derived availability ────────────────────────────────
  const isLockedBySelf =
    row.state === 'CHECKED_OUT' && !!row.lockedById && row.lockedById === meId;
  const isLockedByOther =
    row.state === 'CHECKED_OUT' && !!row.lockedById && row.lockedById !== meId;
  const isInApproval = row.state === 'IN_APPROVAL';

  // checkout: NEW / CHECKED_IN / APPROVED only.
  const canCheckout =
    !isInApproval &&
    !isLockedByOther &&
    (row.state === 'NEW' ||
      row.state === 'CHECKED_IN' ||
      row.state === 'APPROVED') &&
    !!onCheckout;
  // checkin / cancel: locker only.
  const canCheckin = isLockedBySelf && !!onCheckin;
  const canCancelCheckout = isLockedBySelf && !!onCancelCheckout;
  // release (결재상신): CHECKED_IN only.
  const canRelease = row.state === 'CHECKED_IN' && !!onRelease;
  // delete: anything not in approval (admin guard lands in R3c).
  const canDelete = !isInApproval && !!onDelete;

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

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={!canCheckout}
          onSelect={() => handle('체크아웃', onCheckout, 'success')}
        >
          <GitBranch className="text-fg-muted" />
          체크아웃
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canCheckin}
          onSelect={() => handle('체크인', onCheckin, 'success')}
        >
          <CheckCircle2 className="text-fg-muted" />
          체크인
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canCancelCheckout}
          onSelect={() => handle('개정 취소', onCancelCheckout, 'warning')}
        >
          <Undo2 className="text-fg-muted" />
          개정 취소
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canRelease}
          onSelect={() => handle('결재 상신', onRelease)}
        >
          <Send className="text-fg-muted" />
          결재 상신
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          destructive
          disabled={!canDelete}
          onSelect={() => handle('삭제', onDelete, 'warning')}
        >
          <Trash2 />
          삭제
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
