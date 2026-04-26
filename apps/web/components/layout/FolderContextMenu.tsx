'use client';

/**
 * FolderContextMenu — small floating menu shown on folder right-click.
 *
 * Implemented as a portaled fixed-position panel rather than a Radix menu so
 * it can anchor to arbitrary client coordinates (right-click position) instead
 * of a trigger element. Closes on Escape, outside click, or item activation.
 *
 * Items are admin-gated by the caller — when the active user isn't an admin,
 * the host component should simply not pass `onContextMenu` to the tree.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Edit2, FolderPlus, Move, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface FolderContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
  onCreateChild: () => void;
  onRename: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

export function FolderContextMenu({
  position,
  onClose,
  onCreateChild,
  onRename,
  onMove,
  onCopy,
  onDelete,
}: FolderContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    // Mousedown beats click — keeps the menu from flickering when the user
    // clicks an item (which lives inside ref.current).
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [onClose]);

  if (typeof window === 'undefined') return null;

  // Clamp inside the viewport so menus near the right/bottom edge don't
  // overflow.
  const W = 200;
  const H = 220;
  const left = Math.min(position.x, window.innerWidth - W - 8);
  const top = Math.min(position.y, window.innerHeight - H - 8);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left, top }}
      className={cn(
        'fixed z-50 w-[200px] rounded-md border border-border bg-bg p-1 shadow-lg',
        'text-sm text-fg',
      )}
    >
      <MenuItem
        icon={<FolderPlus className="h-3.5 w-3.5" />}
        label="새 하위 폴더"
        onClick={() => {
          onCreateChild();
          onClose();
        }}
      />
      <MenuItem
        icon={<Edit2 className="h-3.5 w-3.5" />}
        label="이름 변경"
        onClick={() => {
          onRename();
          onClose();
        }}
      />
      <MenuItem
        icon={<Move className="h-3.5 w-3.5" />}
        label="이동"
        onClick={() => {
          onMove();
          onClose();
        }}
      />
      <MenuItem
        icon={<Copy className="h-3.5 w-3.5" />}
        label="복사"
        onClick={() => {
          onCopy();
          onClose();
        }}
      />
      <div className="my-1 h-px bg-border" />
      <MenuItem
        icon={<Trash2 className="h-3.5 w-3.5" />}
        label="삭제"
        destructive
        onClick={() => {
          onDelete();
          onClose();
        }}
      />
    </div>,
    document.body,
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded px-2 text-left transition-colors',
        destructive
          ? 'text-danger hover:bg-danger/10'
          : 'text-fg hover:bg-bg-muted',
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
    </button>
  );
}
