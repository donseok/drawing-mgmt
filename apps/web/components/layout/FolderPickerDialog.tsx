'use client';

/**
 * FolderPickerDialog — shared "pick a folder" dialog for move + copy.
 *
 * Reuses the existing FolderTree to render the destination tree. Excludes the
 * source folder and its descendants from selection (otherwise a move would
 * create a cycle and copy would self-clone). Selection drives the confirm
 * button; "루트(최상위)" stays clickable as a sentinel for `parentId = null`.
 *
 * Modes:
 *   - 'move' → onConfirm({ parentId })
 *   - 'copy' → onConfirm({ parentId, folderCode, includeChildren }), with
 *     extra inputs for the new code + includeChildren toggle.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderTree } from '@/components/folder-tree/FolderTree';
import type { FolderNode } from '@/components/folder-tree/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { cn } from '@/lib/cn';

interface ServerFolderNode {
  id: string;
  parentId: string | null;
  name: string;
  folderCode: string;
  defaultClassId: string | null;
  sortOrder: number;
  objectCount: number;
  children: ServerFolderNode[];
}

function adaptFolder(node: ServerFolderNode): FolderNode {
  return {
    id: node.id,
    code: node.folderCode,
    name: node.name,
    objectCount: node.objectCount,
    permission: node.folderCode === 'TRASH' ? 'locked' : 'public',
    children:
      node.children.length > 0 ? node.children.map(adaptFolder) : undefined,
  };
}

const FOLDER_CODE_RE = /^[A-Z0-9_-]+$/;

export type FolderPickerMode = 'move' | 'copy';

export interface FolderPickerSubmit {
  parentId: string | null;
  folderCode?: string;
  includeChildren?: boolean;
}

export interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: FolderPickerMode;
  source: { id: string; name: string; code: string } | null;
  onConfirm: (values: FolderPickerSubmit) => Promise<void>;
}

export function FolderPickerDialog({
  open,
  onOpenChange,
  mode,
  source,
  onConfirm,
}: FolderPickerDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 'root' sentinel = move/copy under the workspace root (parentId=null).
  const [pickRoot, setPickRoot] = useState(false);
  const [folderCode, setFolderCode] = useState('');
  const [includeChildren, setIncludeChildren] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedId(null);
      setPickRoot(false);
      setFolderCode(source ? `${source.code}-COPY` : '');
      setIncludeChildren(true);
      setErr(null);
      setSubmitting(false);
    }
  }, [open, source]);

  const foldersQuery = useQuery<ServerFolderNode[], ApiError>({
    queryKey: queryKeys.folders.tree(),
    queryFn: () => api.get<ServerFolderNode[]>('/api/v1/folders'),
    staleTime: 30_000,
    enabled: open,
  });

  // Hide the source folder + its descendants. Move can't target them
  // (cycle), copy could in principle but the result is rarely useful.
  const blockedIds = useMemo(() => {
    if (!source || !foldersQuery.data) return new Set<string>();
    const all = foldersQuery.data;
    const children = new Map<string, ServerFolderNode[]>();
    const collect = (nodes: ServerFolderNode[]) => {
      for (const n of nodes) {
        if (n.parentId) {
          const list = children.get(n.parentId) ?? [];
          list.push(n);
          children.set(n.parentId, list);
        }
        collect(n.children);
      }
    };
    collect(all);
    const blocked = new Set<string>([source.id]);
    const stack = [source.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const kids = children.get(id) ?? [];
      for (const k of kids) {
        blocked.add(k.id);
        stack.push(k.id);
      }
    }
    return blocked;
  }, [source, foldersQuery.data]);

  const folders = useMemo(() => {
    const data = foldersQuery.data ?? [];
    // Strip blocked subtree. We do this on the adapted node form so the
    // tree component still receives a regular `FolderNode[]`.
    const prune = (nodes: FolderNode[]): FolderNode[] =>
      nodes
        .filter((n) => !blockedIds.has(n.id))
        .map((n) => ({
          ...n,
          children: n.children ? prune(n.children) : undefined,
        }));
    return prune(data.map(adaptFolder));
  }, [foldersQuery.data, blockedIds]);

  const submit = async () => {
    setErr(null);
    if (!source) return;
    if (!pickRoot && !selectedId) {
      setErr('대상 폴더를 선택하세요.');
      return;
    }
    if (mode === 'copy') {
      const trimmed = folderCode.trim().toUpperCase();
      if (!trimmed) {
        setErr('새 폴더 코드를 입력하세요.');
        return;
      }
      if (!FOLDER_CODE_RE.test(trimmed)) {
        setErr('폴더 코드는 영문 대문자/숫자/_-만 허용합니다.');
        return;
      }
      setSubmitting(true);
      try {
        await onConfirm({
          parentId: pickRoot ? null : selectedId!,
          folderCode: trimmed,
          includeChildren,
        });
        onOpenChange(false);
      } catch (e) {
        setErr(e instanceof Error ? e.message : '복사에 실패했습니다.');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    // mode === 'move'
    setSubmitting(true);
    try {
      await onConfirm({ parentId: pickRoot ? null : selectedId! });
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '이동에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'move' ? '폴더 이동' : '폴더 복사';
  const description =
    mode === 'move'
      ? `${source?.name ?? ''}을(를) 옮길 새 상위 폴더를 선택하세요.`
      : `${source?.name ?? ''}을(를) 복사할 위치를 선택하고 새 폴더 코드를 입력하세요.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <button
              type="button"
              onClick={() => {
                setPickRoot(true);
                setSelectedId(null);
              }}
              aria-pressed={pickRoot}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors',
                pickRoot
                  ? 'bg-bg text-fg shadow-sm ring-1 ring-border'
                  : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
              )}
            >
              <span>📦</span>
              <span className="flex-1 text-left">루트 (최상위)</span>
            </button>
          </div>

          <div className="max-h-72 overflow-auto rounded-md border border-border bg-bg-subtle p-2">
            {foldersQuery.isPending ? (
              <div className="space-y-1" role="status" aria-busy="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <div
                    key={i}
                    className="h-7 animate-pulse rounded-md bg-bg-muted/60"
                  />
                ))}
              </div>
            ) : folders.length === 0 ? (
              <div className="px-2 py-3 text-xs text-fg-muted">
                선택 가능한 폴더가 없습니다.
              </div>
            ) : (
              <FolderTree
                nodes={folders}
                selectedId={pickRoot ? undefined : selectedId ?? undefined}
                onSelect={(node) => {
                  setSelectedId(node.id);
                  setPickRoot(false);
                }}
                defaultExpanded={folders.map((f) => f.id)}
              />
            )}
          </div>

          {mode === 'copy' && (
            <>
              <label className="block">
                <span className="app-kicker mb-1 block">새 폴더 코드</span>
                <input
                  type="text"
                  value={folderCode}
                  onChange={(e) => setFolderCode(e.target.value)}
                  maxLength={32}
                  placeholder="예: CGL-MEC-COPY"
                  className="h-9 w-full rounded-md border border-border bg-bg px-2 font-mono text-sm uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="mt-1 text-xs text-fg-subtle">
                  영문 대문자/숫자/_-만 허용. 하위 폴더는 자동 코드(-COPY 접미사)가 붙습니다.
                </p>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeChildren}
                  onChange={(e) => setIncludeChildren(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-brand"
                />
                <span>하위 폴더까지 복사</span>
              </label>
            </>
          )}

          {err ? (
            <p role="alert" className="text-xs text-danger">
              {err}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="app-action-button h-9"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="app-action-button-primary h-9"
          >
            {submitting ? '처리 중…' : mode === 'move' ? '이동' : '복사'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
