'use client';

import * as React from 'react';
import { ChevronRight, Folder, FolderOpen, Lock, Globe2, Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { FolderNode } from './types';

interface FolderTreeProps {
  nodes: FolderNode[];
  selectedId?: string;
  onSelect?: (node: FolderNode) => void;
  /** initial expanded ids (uncontrolled). Ignored when `expanded` is set. */
  defaultExpanded?: string[];
  /**
   * Controlled expansion. When provided, the tree treats this as the single
   * source of truth and routes toggles through `onExpandedChange`. R8 wires
   * the global folder sidebar to a Zustand-backed Set so expansion persists
   * across page navigations.
   */
  expanded?: ReadonlySet<string>;
  onExpandedChange?: (id: string, expanded: boolean) => void;
  className?: string;
  /**
   * R7 — set of folder ids the current user has pinned. The star control is
   * rendered when this prop is provided, regardless of contents (an empty set
   * means "user has no pins yet" rather than "feature off").
   */
  pinnedFolderIds?: ReadonlySet<string>;
  /** Called when the user clicks the star. Caller wires the pin/unpin POST/DELETE. */
  onTogglePin?: (node: FolderNode, nextPinned: boolean) => void;
  /**
   * R9 — right-click context menu fires this. Caller surfaces a menu (rename
   * / new sub-folder / delete) and routes the chosen action to the BE.
   * `position` is in client coordinates so a portaled menu can position itself.
   */
  onContextMenu?: (node: FolderNode, position: { x: number; y: number }) => void;
}

export function FolderTree({
  nodes,
  selectedId,
  onSelect,
  defaultExpanded,
  expanded: controlledExpanded,
  onExpandedChange,
  className,
  pinnedFolderIds,
  onTogglePin,
  onContextMenu,
}: FolderTreeProps) {
  const [internalExpanded, setInternalExpanded] = React.useState<Set<string>>(
    () => new Set(defaultExpanded ?? []),
  );
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded! : internalExpanded;

  const toggle = React.useCallback(
    (id: string) => {
      if (isControlled) {
        const nextExpanded = !controlledExpanded!.has(id);
        onExpandedChange?.(id, nextExpanded);
        return;
      }
      setInternalExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [isControlled, controlledExpanded, onExpandedChange],
  );

  return (
    <ul role="tree" aria-label="폴더 트리" className={cn('select-none text-sm', className)}>
      {nodes.map((node) => (
        <FolderRow
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          selectedId={selectedId}
          onToggle={toggle}
          onSelect={onSelect}
          pinnedFolderIds={pinnedFolderIds}
          onTogglePin={onTogglePin}
          onContextMenu={onContextMenu}
        />
      ))}
    </ul>
  );
}

interface FolderRowProps {
  node: FolderNode;
  depth: number;
  expanded: ReadonlySet<string>;
  selectedId?: string;
  onToggle: (id: string) => void;
  onSelect?: (node: FolderNode) => void;
  pinnedFolderIds?: ReadonlySet<string>;
  onTogglePin?: (node: FolderNode, nextPinned: boolean) => void;
  onContextMenu?: (node: FolderNode, position: { x: number; y: number }) => void;
}

/** Map permission flag to a Korean SR description used in the row aria-label.
 *  BUG-024: previously the row had no accessible name, so screen readers
 *  read it as a bare "treeitem". */
const PERMISSION_LABEL: Record<NonNullable<FolderNode['permission']>, string> = {
  public: '공개',
  restricted: '제한 공개',
  locked: '비공개',
};

function FolderRow({
  node,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
  pinnedFolderIds,
  onTogglePin,
  onContextMenu,
}: FolderRowProps) {
  const hasChildren = !!node.children && node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = node.id === selectedId;
  const pinSupported = !!onTogglePin && !!pinnedFolderIds;
  const isPinned = pinSupported ? pinnedFolderIds!.has(node.id) : false;

  const onRowClick = () => {
    onSelect?.(node);
    if (hasChildren && !isExpanded) onToggle(node.id);
  };

  const onChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) onToggle(node.id);
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(node);
    } else if (e.key === 'ArrowRight' && hasChildren && !isExpanded) {
      e.preventDefault();
      onToggle(node.id);
    } else if (e.key === 'ArrowLeft' && hasChildren && isExpanded) {
      e.preventDefault();
      onToggle(node.id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // R14 — keyboard row nav. We walk DOM-order via the rendered focusable
      // siblings instead of materializing the visible tree shape; every row
      // carries `role="button" tabindex="0"` so the query lands on the same
      // set the user can see.
      e.preventDefault();
      const tree = e.currentTarget.closest('[role="tree"]');
      if (!tree) return;
      const rows = Array.from(
        tree.querySelectorAll<HTMLElement>('[role="button"][tabindex="0"]'),
      );
      const idx = rows.indexOf(e.currentTarget);
      if (idx < 0) return;
      const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
      if (next >= 0 && next < rows.length) rows[next]!.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const tree = e.currentTarget.closest('[role="tree"]');
      if (!tree) return;
      const rows = tree.querySelectorAll<HTMLElement>(
        '[role="button"][tabindex="0"]',
      );
      const target = e.key === 'Home' ? rows[0] : rows[rows.length - 1];
      target?.focus();
    }
  };

  // BUG-024: bundle name + count + permission into a single SR-friendly label.
  // e.g. "기계 폴더, 412개 자료, 공개"
  const ariaLabel = React.useMemo(() => {
    const parts: string[] = [`${node.name} 폴더`];
    if (typeof node.objectCount === 'number') {
      parts.push(`${node.objectCount}개 자료`);
    }
    if (node.permission && PERMISSION_LABEL[node.permission]) {
      parts.push(PERMISSION_LABEL[node.permission]);
    }
    return parts.join(', ');
  }, [node.name, node.objectCount, node.permission]);

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined} aria-selected={isSelected}>
      <div
        tabIndex={0}
        role="button"
        aria-label={ariaLabel}
        onClick={onRowClick}
        onKeyDown={onKey}
        onContextMenu={(e) => {
          if (!onContextMenu) return;
          e.preventDefault();
          onContextMenu(node, { x: e.clientX, y: e.clientY });
        }}
        className={cn(
          'group flex h-7 cursor-pointer items-center gap-1 rounded px-1 outline-none transition-colors',
          'hover:bg-bg-muted focus-visible:ring-2 focus-visible:ring-ring',
          isSelected && 'bg-brand/10 text-fg',
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={hasChildren ? (isExpanded ? '접기' : '펼치기') : undefined}
          aria-hidden={!hasChildren}
          onClick={onChevronClick}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center text-fg-muted',
            !hasChildren && 'invisible',
          )}
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')}
          />
        </button>
        {isExpanded && hasChildren ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
        )}
        <span className="truncate font-medium">{node.name}</span>
        {typeof node.objectCount === 'number' && (
          <span
            className="ml-auto pl-2 text-xs tabular-nums text-fg-muted"
            aria-hidden="true"
          >
            {node.objectCount}
          </span>
        )}
        {node.permission === 'locked' && (
          <Lock className="ml-1 h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />
        )}
        {node.permission === 'public' && (
          <Globe2 className="ml-1 h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />
        )}
        {pinSupported && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={isPinned ? '핀 해제' : '핀 고정'}
            aria-pressed={isPinned}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin?.(node, !isPinned);
            }}
            className={cn(
              'ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg',
              // Always visible when pinned; otherwise reveal on row hover so
              // the trailing column doesn't get noisy when nothing is starred.
              !isPinned && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              isPinned && 'text-amber-500 hover:text-amber-600',
            )}
          >
            <Star
              className={cn('h-3.5 w-3.5', isPinned && 'fill-current')}
              aria-hidden="true"
            />
          </button>
        )}
      </div>
      {hasChildren && isExpanded && (
        <ul role="group">
          {node.children!.map((child) => (
            <FolderRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
              pinnedFolderIds={pinnedFolderIds}
              onTogglePin={onTogglePin}
              onContextMenu={onContextMenu}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
