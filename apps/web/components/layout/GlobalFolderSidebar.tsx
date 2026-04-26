'use client';

/**
 * GlobalFolderSidebar — workspace-wide folder browser (R8 / 사용자 메모 단계 2
 * "폴더 좌측 메뉴").
 *
 * Sits between <NavRail> and the per-page <SubSidebar>. The user toggles it
 * via a button in NavRail or ⌘⇧F (TODO when keyboard map updates). Folder
 * clicks always route to /search?folder=<id> so any page can drill into a
 * folder's contents — the search page becomes the canonical drill view.
 *
 * Why a separate sidebar (vs. just the search page's inline tree):
 *   - Visible from approval / lobby / workspace too — the user no longer has
 *     to bounce to /search to remember "what folder am I in".
 *   - Expansion + width are persisted in `uiStore`; per-page sidebars stay
 *     focused on page-local context (결재함 box, lobby filters, etc.).
 *
 * Collapsed mode mirrors SubSidebar: a 32 px strip with a "↦" toggle that
 * re-opens. Width is dragable via the right-edge separator.
 */

import {
  useCallback,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { ChevronsLeft, FolderTree as FolderTreeIcon, Star } from 'lucide-react';
import { FolderTree } from '@/components/folder-tree/FolderTree';
import type { FolderNode } from '@/components/folder-tree/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';
import { FolderContextMenu } from './FolderContextMenu';
import { FolderEditDialog, type FolderEditMode } from './FolderEditDialog';
import {
  FolderPickerDialog,
  type FolderPickerMode,
  type FolderPickerSubmit,
} from './FolderPickerDialog';

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

interface PinFolderItem {
  kind: 'folder';
  pinId: string;
  sortOrder: number;
  folder: { id: string; name: string; folderCode: string };
}

export function GlobalFolderSidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  // R9 — context-menu actions are admin-gated. We check role on the FE for
  // UX (no menu for non-admins); the BE re-checks for security.
  const isAdmin =
    session?.user?.role === 'SUPER_ADMIN' || session?.user?.role === 'ADMIN';

  const open = useUiStore((s) => s.globalFolderSidebarOpen);
  const width = useUiStore((s) => s.globalFolderSidebarWidth);
  const setWidth = useUiStore((s) => s.setGlobalFolderSidebarWidth);
  const toggle = useUiStore((s) => s.toggleGlobalFolderSidebar);
  const expandedArr = useUiStore((s) => s.folderTreeExpanded);
  const setFolderExpanded = useUiStore((s) => s.setFolderExpanded);
  const replaceFolderExpanded = useUiStore((s) => s.replaceFolderExpanded);

  // Memoize the Set view so React.memo'd children don't see a new reference
  // on unrelated store updates.
  const expandedSet = useMemo(() => new Set(expandedArr), [expandedArr]);

  // The currently-selected folder is read from the URL — keeps the sidebar
  // in sync with the search page without coupling the two via store state.
  const selectedFolderId = searchParams?.get('folder') ?? undefined;

  const foldersQuery = useQuery<ServerFolderNode[], ApiError>({
    queryKey: queryKeys.folders.tree(),
    queryFn: () => api.get<ServerFolderNode[]>('/api/v1/folders'),
    staleTime: 60_000,
    enabled: open, // don't fetch when collapsed — saves the round-trip
  });

  const pinsQuery = useQuery<{ items: PinFolderItem[] }, ApiError>({
    queryKey: queryKeys.pins.list('folder'),
    queryFn: () =>
      api.get<{ items: PinFolderItem[] }>('/api/v1/me/pins', {
        query: { type: 'folder' },
      }),
    staleTime: 60_000,
    enabled: open,
  });

  const folders = useMemo(
    () => (foldersQuery.data ?? []).map(adaptFolder),
    [foldersQuery.data],
  );
  const pinned = pinsQuery.data?.items ?? [];

  const handleSelect = useCallback(
    (node: FolderNode) => {
      router.push(`/search?folder=${node.id}`);
    },
    [router],
  );

  // R9 — context menu / edit dialog state. Local because the menu anchors
  // to a click position and the dialogs need the source folder.
  const [menuTarget, setMenuTarget] = useState<{
    node: FolderNode;
    position: { x: number; y: number };
  } | null>(null);
  const [editState, setEditState] = useState<{
    mode: FolderEditMode;
    target: FolderNode;
  } | null>(null);
  const [pickerState, setPickerState] = useState<{
    mode: FolderPickerMode;
    target: FolderNode;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FolderNode | null>(null);

  const handleContextMenu = useCallback(
    (node: FolderNode, position: { x: number; y: number }) => {
      setMenuTarget({ node, position });
    },
    [],
  );

  const createMutation = useMutation<
    unknown,
    ApiError,
    { parentId: string; name: string; folderCode: string }
  >({
    mutationFn: (vars) =>
      api.post('/api/v1/folders', {
        parentId: vars.parentId,
        name: vars.name,
        folderCode: vars.folderCode,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all() });
      toast.success('폴더를 만들었습니다.');
    },
  });

  const renameMutation = useMutation<
    unknown,
    ApiError,
    { id: string; name: string; folderCode: string }
  >({
    mutationFn: (vars) =>
      api.patch(`/api/v1/folders/${vars.id}`, {
        name: vars.name,
        folderCode: vars.folderCode,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all() });
      toast.success('폴더를 수정했습니다.');
    },
  });

  const moveMutation = useMutation<
    unknown,
    ApiError,
    { id: string; parentId: string | null }
  >({
    mutationFn: (vars) =>
      api.patch(`/api/v1/folders/${vars.id}`, { parentId: vars.parentId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all() });
      toast.success('폴더를 이동했습니다.');
    },
  });

  const copyMutation = useMutation<
    unknown,
    ApiError,
    {
      id: string;
      parentId: string | null;
      folderCode: string;
      includeChildren: boolean;
    }
  >({
    mutationFn: (vars) =>
      api.post(`/api/v1/folders/${vars.id}/copy`, {
        parentId: vars.parentId,
        folderCode: vars.folderCode,
        includeChildren: vars.includeChildren,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all() });
      toast.success('폴더를 복사했습니다.');
    },
  });

  const deleteMutation = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => api.delete(`/api/v1/folders/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all() });
      toast.success('폴더를 삭제했습니다.');
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error('폴더 삭제 실패', { description: err.message });
    },
  });

  const expandAll = useCallback(() => {
    const all: string[] = [];
    const walk = (ns: FolderNode[]) => {
      for (const n of ns) {
        if (n.children && n.children.length > 0) {
          all.push(n.id);
          walk(n.children);
        }
      }
    };
    walk(folders);
    replaceFolderExpanded(all);
  }, [folders, replaceFolderExpanded]);

  const collapseAll = useCallback(() => {
    replaceFolderExpanded([]);
  }, [replaceFolderExpanded]);

  // Drag-to-resize, mirrors SubSidebar.
  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      const onMove = (moveEvent: PointerEvent) => {
        setWidth(startWidth + moveEvent.clientX - startX);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [setWidth, width],
  );

  if (!open) {
    return (
      <aside
        aria-label="폴더 사이드바"
        className="flex h-full w-8 shrink-0 flex-col items-center border-r border-border bg-bg/80"
      >
        <button
          type="button"
          onClick={toggle}
          aria-label="폴더 사이드바 열기"
          title="폴더 사이드바 열기"
          className="mt-3 inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FolderTreeIcon className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="폴더 사이드바"
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-bg/80 backdrop-blur"
    >
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <FolderTreeIcon className="h-4 w-4 text-fg-subtle" />
        <h2 className="app-kicker flex-1 truncate">폴더</h2>
        <button
          type="button"
          onClick={expandAll}
          aria-label="모두 펼치기"
          title="모두 펼치기"
          className="inline-flex h-6 items-center rounded px-1 text-[11px] text-fg-muted hover:bg-bg-muted hover:text-fg"
        >
          펼침
        </button>
        <button
          type="button"
          onClick={collapseAll}
          aria-label="모두 접기"
          title="모두 접기"
          className="inline-flex h-6 items-center rounded px-1 text-[11px] text-fg-muted hover:bg-bg-muted hover:text-fg"
        >
          접기
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label="폴더 사이드바 접기"
          title="폴더 사이드바 접기"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-fg"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto px-2 py-2">
        {pinned.length > 0 && (
          <div className="mb-3 space-y-1 border-b border-border pb-3">
            <div className="px-1 pb-1 text-[11px] font-semibold uppercase text-fg-subtle">
              즐겨찾기
            </div>
            {pinned.map((p) => (
              <Link
                key={p.pinId}
                href={`/search?folder=${p.folder.id}`}
                className={cn(
                  'group flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors',
                  p.folder.id === selectedFolderId
                    ? 'bg-bg text-fg shadow-sm ring-1 ring-border'
                    : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
                )}
              >
                <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
                <span className="flex-1 truncate text-left">{p.folder.name}</span>
                <span className="font-mono text-[10px] text-fg-subtle">
                  {p.folder.folderCode}
                </span>
              </Link>
            ))}
          </div>
        )}

        {foldersQuery.isPending ? (
          <div className="space-y-1 px-1" role="status" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="h-7 animate-pulse rounded-md bg-bg-muted/60"
              />
            ))}
          </div>
        ) : foldersQuery.isError ? (
          <div className="px-2 py-3 text-xs text-fg-muted">
            폴더 트리를 불러오지 못했습니다.
          </div>
        ) : folders.length === 0 ? (
          <div className="px-2 py-3 text-xs text-fg-muted">폴더가 없습니다.</div>
        ) : (
          <FolderTree
            nodes={folders}
            selectedId={selectedFolderId}
            onSelect={handleSelect}
            expanded={expandedSet}
            onExpandedChange={setFolderExpanded}
            onContextMenu={isAdmin ? handleContextMenu : undefined}
          />
        )}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="폴더 사이드바 너비 조절"
        title="폴더 사이드바 너비 조절"
        onPointerDown={startResize}
        className="absolute inset-y-0 -right-1 w-2 cursor-col-resize"
      >
        <span className="block h-full w-px translate-x-1 bg-transparent transition-colors hover:bg-brand/50" />
      </div>

      {menuTarget && (
        <FolderContextMenu
          position={menuTarget.position}
          onClose={() => setMenuTarget(null)}
          onCreateChild={() =>
            setEditState({ mode: 'create-child', target: menuTarget.node })
          }
          onRename={() =>
            setEditState({ mode: 'rename', target: menuTarget.node })
          }
          onMove={() =>
            setPickerState({ mode: 'move', target: menuTarget.node })
          }
          onCopy={() =>
            setPickerState({ mode: 'copy', target: menuTarget.node })
          }
          onDelete={() => setDeleteTarget(menuTarget.node)}
        />
      )}

      {pickerState && (
        <FolderPickerDialog
          open
          onOpenChange={(o) => {
            if (!o) setPickerState(null);
          }}
          mode={pickerState.mode}
          source={{
            id: pickerState.target.id,
            name: pickerState.target.name,
            code: pickerState.target.code,
          }}
          onConfirm={async (values: FolderPickerSubmit) => {
            if (pickerState.mode === 'move') {
              await moveMutation.mutateAsync({
                id: pickerState.target.id,
                parentId: values.parentId,
              });
            } else {
              await copyMutation.mutateAsync({
                id: pickerState.target.id,
                parentId: values.parentId,
                folderCode: values.folderCode!,
                includeChildren: values.includeChildren ?? true,
              });
            }
          }}
        />
      )}

      {editState && (
        <FolderEditDialog
          open
          onOpenChange={(o) => {
            if (!o) setEditState(null);
          }}
          mode={editState.mode}
          contextFolder={{
            id: editState.target.id,
            name: editState.target.name,
            code: editState.target.code,
          }}
          initialName={editState.mode === 'rename' ? editState.target.name : ''}
          initialFolderCode={
            editState.mode === 'rename' ? editState.target.code : ''
          }
          onSubmit={async (values) => {
            if (editState.mode === 'create-child') {
              await createMutation.mutateAsync({
                parentId: editState.target.id,
                name: values.name,
                folderCode: values.folderCode,
              });
            } else {
              await renameMutation.mutateAsync({
                id: editState.target.id,
                name: values.name,
                folderCode: values.folderCode,
              });
            }
          }}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title={`'${deleteTarget?.name ?? ''}' 폴더를 삭제하시겠습니까?`}
        description="자료가 남아있거나 하위 폴더가 있으면 삭제되지 않습니다. 비어 있는 폴더만 삭제 가능합니다."
        confirmText="삭제"
        variant="destructive"
        disabled={deleteMutation.isPending}
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id);
        }}
      />
    </aside>
  );
}
