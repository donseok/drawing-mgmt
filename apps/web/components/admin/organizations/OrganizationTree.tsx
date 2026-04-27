'use client';

import * as React from 'react';
import { Building2, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { OrganizationTreeNode } from './types';

/**
 * R30 §A.3 — Organization tree (admin-only). Sibling shape and keyboard
 * navigation mirrors `<FolderTree>` (DESIGN parallel signature). `userCount`
 * is rendered tabular-nums on the right.
 */
export interface OrganizationTreeProps {
  nodes: OrganizationTreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  defaultExpanded?: string[];
  expanded?: ReadonlySet<string>;
  onExpandedChange?: (id: string, expanded: boolean) => void;
  className?: string;
}

export function OrganizationTree({
  nodes,
  selectedId,
  onSelect,
  defaultExpanded,
  expanded: controlledExpanded,
  onExpandedChange,
  className,
}: OrganizationTreeProps): JSX.Element {
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
    <ul
      role="tree"
      aria-label="조직 트리"
      className={cn('select-none text-sm', className)}
    >
      {nodes.map((node) => (
        <OrgRow
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          selectedId={selectedId}
          onToggle={toggle}
          onSelect={onSelect}
          isRoot
        />
      ))}
    </ul>
  );
}

interface OrgRowProps {
  node: OrganizationTreeNode;
  depth: number;
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  isRoot?: boolean;
}

function OrgRow({
  node,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
  isRoot,
}: OrgRowProps): JSX.Element {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = node.id === selectedId;

  const onRowClick = () => {
    onSelect(node.id);
    if (hasChildren && !isExpanded) onToggle(node.id);
  };

  const onChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) onToggle(node.id);
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(node.id);
    } else if (e.key === 'ArrowRight' && hasChildren && !isExpanded) {
      e.preventDefault();
      onToggle(node.id);
    } else if (e.key === 'ArrowLeft' && hasChildren && isExpanded) {
      e.preventDefault();
      onToggle(node.id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
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

  const ariaLabel = `${node.name} 조직, ${node.userCount}명 소속${
    hasChildren ? `, 자식 ${node.children.length}개` : ''
  }`;

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={isSelected}
    >
      <div
        tabIndex={0}
        role="button"
        aria-label={ariaLabel}
        onClick={onRowClick}
        onKeyDown={onKey}
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
            className={cn(
              'h-3.5 w-3.5 transition-transform',
              isExpanded && 'rotate-90',
            )}
          />
        </button>
        <Building2
          className={cn(
            'h-4 w-4 shrink-0',
            isRoot ? 'text-brand-500' : 'text-fg-muted',
          )}
          aria-hidden="true"
        />
        <span className="truncate font-medium">{node.name}</span>
        <span
          className="ml-auto pl-2 text-xs tabular-nums text-fg-muted"
          aria-hidden="true"
        >
          {node.userCount}
        </span>
      </div>
      {hasChildren && isExpanded ? (
        <ul role="group">
          {node.children.map((child) => (
            <OrgRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
