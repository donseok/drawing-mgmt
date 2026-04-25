'use client';

import * as React from 'react';
import { ChevronRight, Folder, FolderOpen, Lock, Globe2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { FolderNode } from './types';

interface FolderTreeProps {
  nodes: FolderNode[];
  selectedId?: string;
  onSelect?: (node: FolderNode) => void;
  /** initial expanded ids (uncontrolled). */
  defaultExpanded?: string[];
  className?: string;
}

export function FolderTree({ nodes, selectedId, onSelect, defaultExpanded, className }: FolderTreeProps) {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(defaultExpanded ?? []));

  const toggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
        />
      ))}
    </ul>
  );
}

interface FolderRowProps {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  selectedId?: string;
  onToggle: (id: string) => void;
  onSelect?: (node: FolderNode) => void;
}

function FolderRow({ node, depth, expanded, selectedId, onToggle, onSelect }: FolderRowProps) {
  const hasChildren = !!node.children && node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = node.id === selectedId;

  const onRowClick = () => {
    onSelect?.(node);
    if (hasChildren && !isExpanded) onToggle(node.id);
  };

  const onChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) onToggle(node.id);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(node);
    } else if (e.key === 'ArrowRight' && hasChildren && !isExpanded) {
      e.preventDefault();
      onToggle(node.id);
    } else if (e.key === 'ArrowLeft' && hasChildren && isExpanded) {
      e.preventDefault();
      onToggle(node.id);
    }
  };

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined} aria-selected={isSelected}>
      <div
        tabIndex={0}
        onClick={onRowClick}
        onKeyDown={onKey}
        // TODO: right-click context menu (신규등록 / 하위폴더 생성 / 이름변경 / 이동 / 복사)
        onContextMenu={(e) => {
          e.preventDefault();
          // placeholder
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
          <FolderOpen className="h-4 w-4 shrink-0 text-brand-500" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-fg-muted" />
        )}
        <span className="truncate font-medium">{node.name}</span>
        {typeof node.objectCount === 'number' && (
          <span className="ml-auto pl-2 text-xs tabular-nums text-fg-muted">{node.objectCount}</span>
        )}
        {node.permission === 'locked' && <Lock className="ml-1 h-3.5 w-3.5 text-fg-muted" aria-label="제한 폴더" />}
        {node.permission === 'public' && (
          <Globe2 className="ml-1 h-3.5 w-3.5 text-fg-muted" aria-label="공개 폴더" />
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}
