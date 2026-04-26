'use client';

/**
 * ObjectMoveDialog — pick a destination folder for bulk move/copy of objects.
 *
 * Shares its tree picker shape with FolderPickerDialog but speaks objects:
 *   - mode='move' → POST /api/v1/objects/bulk-move
 *   - mode='copy' → POST /api/v1/objects/bulk-copy (BE auto-derives unique
 *                   numbers via `<original>-COPY` / `-COPY2` suffixes)
 *
 * The caller passes the selected ids and the current folder id; the latter is
 * used to disable confirm when the user tries to "move into here".
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

export type ObjectMoveMode = 'move' | 'copy';

export interface ObjectMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ObjectMoveMode;
  selectedCount: number;
  /** Source folder id, when known — disables confirm if the user picks the
   *  same folder (avoids no-op moves). Undefined skips the guard. */
  currentFolderId?: string;
  onConfirm: (targetFolderId: string) => Promise<void>;
}

export function ObjectMoveDialog({
  open,
  onOpenChange,
  mode,
  selectedCount,
  currentFolderId,
  onConfirm,
}: ObjectMoveDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedId(null);
      setErr(null);
      setSubmitting(false);
    }
  }, [open]);

  const foldersQuery = useQuery<ServerFolderNode[], ApiError>({
    queryKey: queryKeys.folders.tree(),
    queryFn: () => api.get<ServerFolderNode[]>('/api/v1/folders'),
    staleTime: 30_000,
    enabled: open,
  });

  const folders = useMemo(
    () => (foldersQuery.data ?? []).map(adaptFolder),
    [foldersQuery.data],
  );

  const sameAsCurrent =
    mode === 'move' && currentFolderId !== undefined && selectedId === currentFolderId;

  const submit = async () => {
    setErr(null);
    if (!selectedId) {
      setErr('대상 폴더를 선택하세요.');
      return;
    }
    if (sameAsCurrent) {
      setErr('이미 같은 폴더에 있는 자료입니다.');
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(selectedId);
      onOpenChange(false);
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : mode === 'move' ? '이동에 실패했습니다.' : '복사에 실패했습니다.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'move' ? '자료 이동' : '자료 복사';
  const description =
    mode === 'move'
      ? `선택한 ${selectedCount}건의 자료를 옮길 폴더를 선택하세요.`
      : `선택한 ${selectedCount}건의 자료를 복사할 폴더를 선택하세요. 도면번호는 자동으로 -COPY 접미사가 붙습니다.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

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
              selectedId={selectedId ?? undefined}
              onSelect={(node) => setSelectedId(node.id)}
              defaultExpanded={folders.map((f) => f.id)}
            />
          )}
        </div>

        {err ? (
          <p role="alert" className="text-xs text-danger">
            {err}
          </p>
        ) : null}

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
            disabled={submitting || !selectedId || sameAsCurrent}
            className="app-action-button-primary h-9"
          >
            {submitting ? '처리 중…' : mode === 'move' ? '이동' : '복사'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
