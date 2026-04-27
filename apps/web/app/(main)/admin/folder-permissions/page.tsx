'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { AdminSidebar } from '@/app/(main)/admin/AdminSidebar';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { FolderTree } from '@/components/folder-tree/FolderTree';
import type { FolderNode } from '@/components/folder-tree/types';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  PermissionMatrix,
  type PermissionMatrixServerRow,
  type PermissionMatrixSubmitRow,
} from '@/components/permission-matrix/PermissionMatrix';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

/**
 * /admin/folder-permissions — DESIGN r28 §A.
 *
 * 3-pane: AdminSidebar / FolderTree / PermissionMatrix.
 * Selecting a folder mounts the matrix; the matrix tracks dirty state and
 * full-replaces via PUT /api/v1/folders/:id/permissions on save.
 *
 * Layout-level admin gate is handled by `(main)/admin/page.tsx` and the API
 * (403 if non-admin); we rely on the BE to reject GET/PUT for non-admins.
 */

// ── Wire shapes ──────────────────────────────────────────────────────────
// /api/v1/folders → server folder tree (mirrors search/page.tsx).
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

// GET /api/v1/folders/:id/permissions — api_contract.md §3.1.
// The BE returns:
//   { ok: true, data: { folder }, meta: { permissions: [...] } }
// `apiRequest` already unwraps `data`, so we pull `permissions` from `meta`.
// To get at `meta` we issue the fetch directly here; the wrapper happens to
// strip `meta`. Practical fix: hit the raw endpoint and re-shape ourselves.
interface FolderPermissionsResponse {
  ok: true;
  data: {
    folder: {
      id: string;
      name: string;
      folderCode: string;
      parentId: string | null;
    };
  };
  meta: {
    permissions: PermissionMatrixServerRow[];
    lastModifiedAt?: string;
  };
}

async function fetchFolderPermissions(
  folderId: string,
): Promise<{ folder: FolderPermissionsResponse['data']['folder']; permissions: PermissionMatrixServerRow[] }> {
  // We need the `meta.permissions` envelope. `api.get` would unwrap `data`
  // and discard meta — issue a plain fetch and parse the full envelope.
  const res = await fetch(`/api/v1/folders/${folderId}/permissions`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const env = (parsed as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(env?.message ?? `Request failed (${res.status})`, {
      code: env?.code,
      status: res.status,
    });
  }
  const env = parsed as FolderPermissionsResponse;
  return {
    folder: env.data.folder,
    permissions: env.meta.permissions,
  };
}

// ── Folder adapter (mirrors search/page.tsx) ─────────────────────────────
function adaptFolder(node: ServerFolderNode): FolderNode {
  const isTrash = node.folderCode === 'TRASH';
  return {
    id: node.id,
    code: node.folderCode,
    name: node.name,
    objectCount: node.objectCount,
    permission: isTrash ? 'locked' : 'public',
    children: node.children.length > 0 ? node.children.map(adaptFolder) : undefined,
  };
}

// Walk the tree to assemble the breadcrumb path "본사 / 기계 / CGL-2".
function findFolderPath(
  nodes: FolderNode[],
  id: string,
  trail: string[] = [],
): string[] | null {
  for (const n of nodes) {
    const next = [...trail, n.name];
    if (n.id === id) return next;
    if (n.children) {
      const sub = findFolderPath(n.children, id, next);
      if (sub) return sub;
    }
  }
  return null;
}

export default function FolderPermissionsPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderId = searchParams?.get('folderId') ?? null;
  const queryClient = useQueryClient();

  // <1280 read-only fallback (PM-DECISION-6).
  const isWide = useMediaQuery('(min-width: 1280px)');
  const readOnly = !isWide;

  // ── Folder tree query ──────────────────────────────────────────────────
  const treeQuery = useQuery<FolderNode[], ApiError>({
    queryKey: queryKeys.folders.tree(),
    queryFn: async () => {
      const data = await api.get<ServerFolderNode[]>('/api/v1/folders');
      return data.map(adaptFolder);
    },
    staleTime: 60_000,
  });

  // ── Permissions query ──────────────────────────────────────────────────
  // Only fetches when a folder is selected; v5 — placeholderData handled by
  // the matrix's reducer-reseed effect (we don't keep prior data here).
  const permissionsQuery = useQuery<
    { folder: FolderPermissionsResponse['data']['folder']; permissions: PermissionMatrixServerRow[] },
    ApiError
  >({
    queryKey: queryKeys.admin.folderPermissions(folderId ?? '__none__'),
    queryFn: () => fetchFolderPermissions(folderId!),
    enabled: !!folderId,
    staleTime: 0,
  });

  // ── Save mutation ──────────────────────────────────────────────────────
  const saveMutation = useMutation<
    unknown,
    ApiError,
    { folderId: string; rows: PermissionMatrixSubmitRow[] }
  >({
    mutationFn: ({ folderId: id, rows }) =>
      api.put(`/api/v1/folders/${id}/permissions`, { permissions: rows }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.folderPermissions(vars.folderId),
      });
      toast.success('권한이 저장되었습니다.', {
        description: `${vars.rows.length}개 행`,
      });
    },
    onError: (err) => {
      // Friendly hint mapping for the most common cases. The matrix keeps the
      // dirty state intact so the admin can fix and retry.
      const hint =
        err.status === 403
          ? '권한 부족 (SUPER_ADMIN 또는 ADMIN만 편집할 수 있습니다)'
          : err.status === 404
            ? '폴더가 삭제되었습니다. 트리를 새로고침하세요.'
            : err.status === 409
              ? '다른 사용자가 같은 폴더를 수정했습니다. 새로고침 후 다시 시도하세요.'
              : err.code === 'E_RATE_LIMIT'
                ? '요청 빈도 제한에 걸렸습니다. 잠시 후 다시 시도하세요.'
                : err.message;
      toast.error('저장 실패', { description: hint });
    },
  });

  // ── Unsaved-changes guard ──────────────────────────────────────────────
  const [dirtyCount, setDirtyCount] = React.useState(0);
  React.useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyCount]);

  // Intra-app navigation: when the admin clicks another folder, prompt before
  // discarding edits. We can't intercept `router.push` from outside, but we
  // CAN gate FolderTree's onSelect since this is the only realistic exit.
  const [pendingFolderId, setPendingFolderId] = React.useState<string | null>(null);
  const handleSelectFolder = React.useCallback(
    (node: FolderNode) => {
      if (dirtyCount > 0 && node.id !== folderId) {
        setPendingFolderId(node.id);
        return;
      }
      const sp = new URLSearchParams(searchParams?.toString() ?? '');
      sp.set('folderId', node.id);
      router.replace(`/admin/folder-permissions?${sp.toString()}`);
    },
    [dirtyCount, folderId, router, searchParams],
  );

  const navigateToPending = React.useCallback(() => {
    if (!pendingFolderId) return;
    const sp = new URLSearchParams(searchParams?.toString() ?? '');
    sp.set('folderId', pendingFolderId);
    router.replace(`/admin/folder-permissions?${sp.toString()}`);
    setPendingFolderId(null);
    setDirtyCount(0);
  }, [pendingFolderId, router, searchParams]);

  const handleCloseMatrix = React.useCallback(() => {
    if (dirtyCount > 0) {
      // Re-use the same guard — pending = "no folder", which we model with empty.
      const ok = window.confirm(
        '저장하지 않은 변경사항이 있습니다. 정말 닫으시겠습니까?',
      );
      if (!ok) return;
    }
    const sp = new URLSearchParams(searchParams?.toString() ?? '');
    sp.delete('folderId');
    const qs = sp.toString();
    router.replace(qs ? `/admin/folder-permissions?${qs}` : '/admin/folder-permissions');
    setDirtyCount(0);
  }, [dirtyCount, router, searchParams]);

  const folders = treeQuery.data ?? [];
  const selectedPath = folderId ? findFolderPath(folders, folderId) : null;
  const breadcrumbLabel = selectedPath?.join(' / ') ?? '';

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />

      <SubSidebar title="폴더 트리">
        {treeQuery.isPending ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : treeQuery.isError ? (
          <div className="px-3 py-4">
            <EmptyState
              icon={ShieldAlert}
              title="폴더 트리를 불러오지 못했습니다"
              action={
                <Button size="sm" variant="outline" onClick={() => void treeQuery.refetch()}>
                  재시도
                </Button>
              }
            />
          </div>
        ) : (
          <FolderTree
            nodes={folders}
            selectedId={folderId ?? undefined}
            onSelect={handleSelectFolder}
            defaultExpanded={folders.map((f) => f.id)}
          />
        )}
      </SubSidebar>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
          <span className="text-fg-muted">관리자</span>
          <span className="text-fg-subtle">/</span>
          <span className="font-medium text-fg">권한 매트릭스</span>
          {breadcrumbLabel ? (
            <>
              <span className="text-fg-subtle">/</span>
              <span className="font-mono-num text-[12px] text-fg-muted">{breadcrumbLabel}</span>
            </>
          ) : null}
        </div>

        {readOnly ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            ⚠ 화면이 좁아 편집 모드를 사용할 수 없습니다. 1280px 이상의 화면에서 접속하세요.
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          {!folderId ? (
            <div className="flex flex-1 items-center justify-center p-10">
              <EmptyState
                icon={ShieldCheck}
                title="왼쪽 트리에서 폴더를 선택해 권한을 편집하세요"
                description="폴더 단위로 사용자/조직/그룹의 8개 권한 비트를 편집할 수 있습니다."
              />
            </div>
          ) : permissionsQuery.isPending ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-12 w-full" />
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : permissionsQuery.isError ? (
            <div className="flex flex-1 items-center justify-center p-10">
              <EmptyState
                icon={ShieldAlert}
                title={
                  permissionsQuery.error?.status === 403
                    ? '이 폴더의 권한을 볼 권한이 없습니다'
                    : permissionsQuery.error?.status === 404
                      ? '폴더를 찾을 수 없습니다 (삭제되었을 수 있습니다)'
                      : '권한을 불러오지 못했습니다'
                }
                description={permissionsQuery.error?.message ?? undefined}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void permissionsQuery.refetch()}
                  >
                    재시도
                  </Button>
                }
              />
            </div>
          ) : (
            <PermissionMatrix
              folder={{
                id: permissionsQuery.data.folder.id,
                name: permissionsQuery.data.folder.name,
                pathLabel: breadcrumbLabel || permissionsQuery.data.folder.name,
              }}
              initialPermissions={permissionsQuery.data.permissions}
              readOnly={readOnly}
              refetching={permissionsQuery.isFetching && !permissionsQuery.isPending}
              onSave={async (rows) => {
                // folderId is non-null here (we are inside the `permissionsQuery.data`
                // branch, which only renders when folderId was set). Narrow with
                // an inline guard so the closure doesn't carry a nullable.
                const id = folderId;
                if (!id) return;
                await saveMutation.mutateAsync({ folderId: id, rows });
              }}
              onClose={handleCloseMatrix}
              onDirtyCountChange={setDirtyCount}
            />
          )}
        </div>
      </section>

      {/* Intra-app navigation guard. Renders only when the admin clicks
          another folder while dirty. Mirrors spec §A.7 Layer 2.
          Note: "save then navigate" needs reducer-level access we don't
          surface to the page in v1; we instead direct the admin back to the
          matrix's [저장] button so the same flow is reused. */}
      {pendingFolderId ? (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPendingFolderId(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-bg p-5 elevation-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-fg">변경사항이 저장되지 않았습니다</h3>
            <p className="mt-1 text-sm text-fg-muted">
              저장하지 않은 변경 {dirtyCount}건이 사라집니다. 폴더를 이동할까요?
            </p>
            <p className="mt-2 text-xs text-fg-subtle">
              저장이 필요하면 먼저 매트릭스의 [저장] 버튼을 누르세요.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingFolderId(null)}>
                취소
              </Button>
              <Button variant="destructive" onClick={navigateToPending}>
                버리고 이동
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
