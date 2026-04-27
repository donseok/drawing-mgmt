'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, Plus, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';

import { AdminSidebar } from '@/app/(main)/admin/AdminSidebar';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';

import { OrganizationTree } from '@/components/admin/organizations/OrganizationTree';
import { OrganizationDetailPanel } from '@/components/admin/organizations/OrganizationDetailPanel';
import { OrgEditDialog } from '@/components/admin/organizations/OrgEditDialog';
import { OrgDeleteDialog } from '@/components/admin/organizations/OrgDeleteDialog';
import {
  type AdminOrganization,
  type OrgEditValues,
  buildOrgPath,
  buildOrgTree,
  childrenOf,
  siblingsOf,
} from '@/components/admin/organizations/types';

import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

/**
 * /admin/organizations — R30 U-3.
 *
 * 3-pane: AdminSidebar / OrganizationTree (sub sidebar) / detail panel.
 * The tree fetches the flat list once; FE composes the tree, breadcrumb,
 * siblings, and direct-children. ↑↓ reorder dispatches POST /reorder.
 *
 * Layout-level admin gate handled by `(main)/admin/page.tsx`; we still
 * gracefully render an EmptyState if the BE returns 403.
 */

interface OrgMemberPreview {
  id: string;
  username: string;
  fullName: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'PARTNER';
}

interface OrgMembersResponse {
  data: OrgMemberPreview[];
  meta?: { total?: number };
}

async function fetchOrgMembers(
  orgId: string,
): Promise<OrgMembersResponse | null> {
  // Best-effort: hit the same admin/users list with the organizationId
  // filter. If the BE doesn't yet support it (R30 PM-DECISION-3 fallback),
  // we surface "사용자 페이지에서 확인" instead of crashing.
  const url = new URL('/api/v1/admin/users', window.location.origin);
  url.searchParams.set('organizationId', orgId);
  url.searchParams.set('limit', '6');
  const res = await fetch(url.toString(), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const text = await res.text();
  try {
    const env = text ? JSON.parse(text) : null;
    if (!env) return null;
    return {
      data: (env.data ?? []) as OrgMemberPreview[],
      meta: env.meta ?? undefined,
    };
  } catch {
    return null;
  }
}

export default function OrganizationsAdminPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const orgId = searchParams?.get('orgId') ?? null;

  // ── Tree query ─────────────────────────────────────────────────────────
  const treeQuery = useQuery<AdminOrganization[], ApiError>({
    queryKey: queryKeys.admin.organizationsTree(),
    queryFn: () =>
      api.get<AdminOrganization[]>('/api/v1/admin/organizations'),
    staleTime: 30_000,
  });

  const flatList = React.useMemo(
    () => treeQuery.data ?? [],
    [treeQuery.data],
  );
  const tree = React.useMemo(() => buildOrgTree(flatList), [flatList]);

  const selectedOrg = React.useMemo(
    () => (orgId ? flatList.find((o) => o.id === orgId) ?? null : null),
    [flatList, orgId],
  );
  const breadcrumb = React.useMemo(
    () => (orgId ? buildOrgPath(flatList, orgId) : []),
    [flatList, orgId],
  );
  const siblings = React.useMemo(
    () => (orgId ? siblingsOf(flatList, orgId) : []),
    [flatList, orgId],
  );
  const childrenList = React.useMemo(
    () => (orgId ? childrenOf(flatList, orgId) : []),
    [flatList, orgId],
  );

  // ── Members preview query (PM-DECISION-3 — fallback-tolerant) ───────────
  const membersQuery = useQuery<OrgMembersResponse | null, ApiError>({
    queryKey: queryKeys.admin.organizationMembers(orgId ?? '__none__', {
      limit: 6,
    }),
    queryFn: () => fetchOrgMembers(orgId!),
    enabled: !!orgId,
    staleTime: 30_000,
  });
  const membersUnsupported =
    !!orgId && !membersQuery.isPending && membersQuery.data === null;

  // ── URL sync helpers ──────────────────────────────────────────────────
  const selectOrg = React.useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? '');
      if (id) sp.set('orgId', id);
      else sp.delete('orgId');
      const qs = sp.toString();
      router.replace(qs ? `/admin/organizations?${qs}` : '/admin/organizations');
    },
    [router, searchParams],
  );

  // ── Mutations ─────────────────────────────────────────────────────────
  const invalidateTree = React.useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.admin.organizations(),
    });
  }, [queryClient]);

  interface CreatePayload {
    name: string;
    parentId: string | null;
    sortOrder?: number;
  }
  const createMutation = useMutation<AdminOrganization, ApiError, CreatePayload>({
    mutationFn: (body) =>
      api.post<AdminOrganization>('/api/v1/admin/organizations', body),
    onSuccess: (data) => {
      toast.success(`조직이 추가되었습니다 (${data.name})`);
      invalidateTree();
      // Auto-select the new org so the detail panel shows it.
      selectOrg(data.id);
    },
    onError: (err) => {
      if (err.code === 'E_VALIDATION' || err.code === 'E_CONFLICT') return;
      toast.error('조직 추가 실패', { description: friendly(err) });
    },
  });

  interface PatchPayload {
    id: string;
    body: { name?: string; parentId?: string | null; sortOrder?: number };
  }
  const updateMutation = useMutation<AdminOrganization, ApiError, PatchPayload>({
    mutationFn: ({ id, body }) =>
      api.patch<AdminOrganization>(`/api/v1/admin/organizations/${id}`, body),
    onSuccess: () => {
      toast.success('변경사항이 저장되었습니다');
      invalidateTree();
    },
    onError: (err) => {
      if (err.code === 'E_VALIDATION' || err.code === 'E_CONFLICT') return;
      // Cycle guard surfaces server-side as 409 E_STATE_CONFLICT.
      if (err.code === 'E_STATE_CONFLICT') {
        toast.error('이동할 수 없습니다', {
          description: '선택한 부모는 자신의 후손이라 이동할 수 없습니다.',
        });
        return;
      }
      toast.error('수정 실패', { description: friendly(err) });
    },
  });

  const deleteMutation = useMutation<unknown, ApiError, AdminOrganization>({
    mutationFn: (org) => api.delete(`/api/v1/admin/organizations/${org.id}`),
    onSuccess: (_d, org) => {
      toast.success(`조직이 삭제되었습니다 (${org.name})`);
      invalidateTree();
      // If the deleted one was selected, clear selection.
      if (orgId === org.id) selectOrg(null);
    },
    onError: (err) => {
      if (err.code === 'E_STATE_CONFLICT') {
        // Surface to dialog by setting forceBlocked. The dialog already
        // shows the cannot-delete mode in this case.
        toast.error('삭제할 수 없습니다', {
          description:
            '자식 조직 또는 소속 사용자가 남아 있습니다. 트리를 새로고침하세요.',
        });
        invalidateTree();
        return;
      }
      toast.error('삭제 실패', { description: friendly(err) });
    },
  });

  interface ReorderPayload {
    parentId: string | null;
    ids: string[];
  }
  const reorderMutation = useMutation<unknown, ApiError, ReorderPayload>({
    mutationFn: (body) =>
      api.post('/api/v1/admin/organizations/reorder', body),
    onMutate: async (vars) => {
      // Optimistic: re-order siblings in the cached list.
      await queryClient.cancelQueries({
        queryKey: queryKeys.admin.organizationsTree(),
      });
      const prev = queryClient.getQueryData<AdminOrganization[]>(
        queryKeys.admin.organizationsTree(),
      );
      if (prev) {
        // Rewrite sortOrder of `vars.ids` to their new index.
        const orderIndex = new Map(vars.ids.map((id, i) => [id, i] as const));
        const next = prev.map((o) => {
          if (o.parentId === vars.parentId && orderIndex.has(o.id)) {
            return { ...o, sortOrder: orderIndex.get(o.id)! };
          }
          return o;
        });
        queryClient.setQueryData(queryKeys.admin.organizationsTree(), next);
      }
      return { prev };
    },
    onSuccess: () => {
      toast.success('정렬이 변경되었습니다');
    },
    onError: (err, _vars, ctx) => {
      if (
        ctx &&
        typeof ctx === 'object' &&
        'prev' in ctx &&
        (ctx as { prev?: AdminOrganization[] }).prev
      ) {
        queryClient.setQueryData(
          queryKeys.admin.organizationsTree(),
          (ctx as { prev: AdminOrganization[] }).prev,
        );
      }
      toast.error('정렬 변경 실패', { description: friendly(err) });
    },
    onSettled: () => {
      invalidateTree();
    },
  });

  // ── Dialog state ───────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = React.useState<{
    parentId: string | null;
  } | null>(null);
  const [editTarget, setEditTarget] = React.useState<AdminOrganization | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] =
    React.useState<AdminOrganization | null>(null);

  // ── Move handlers ─────────────────────────────────────────────────────
  const handleMoveUp = () => {
    if (!selectedOrg) return;
    const i = siblings.findIndex((s) => s.id === selectedOrg.id);
    if (i <= 0) return;
    const reordered = [...siblings];
    const [moved] = reordered.splice(i, 1);
    if (!moved) return;
    reordered.splice(i - 1, 0, moved);
    reorderMutation.mutate({
      parentId: selectedOrg.parentId,
      ids: reordered.map((s) => s.id),
    });
  };
  const handleMoveDown = () => {
    if (!selectedOrg) return;
    const i = siblings.findIndex((s) => s.id === selectedOrg.id);
    if (i < 0 || i >= siblings.length - 1) return;
    const reordered = [...siblings];
    const [moved] = reordered.splice(i, 1);
    if (!moved) return;
    reordered.splice(i + 1, 0, moved);
    reorderMutation.mutate({
      parentId: selectedOrg.parentId,
      ids: reordered.map((s) => s.id),
    });
  };

  const handleCreate = async (values: OrgEditValues) => {
    await createMutation.mutateAsync({
      name: values.name,
      parentId: values.parentId ?? null,
      sortOrder:
        typeof values.sortOrder === 'number' ? values.sortOrder : undefined,
    });
  };

  const handleEdit = async (values: OrgEditValues) => {
    if (!editTarget) return;
    await updateMutation.mutateAsync({
      id: editTarget.id,
      body: {
        name: values.name,
        parentId: values.parentId ?? null,
        sortOrder:
          typeof values.sortOrder === 'number' ? values.sortOrder : undefined,
      },
    });
  };

  // ── Empty / error renderers for the left tree column ──────────────────
  const renderTreeColumn = (): React.ReactNode => {
    if (treeQuery.isPending) {
      return (
        <div className="space-y-2 p-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      );
    }
    if (treeQuery.isError) {
      const err = treeQuery.error;
      if (err && err.status === 403) {
        return (
          <div className="px-3 py-4">
            <EmptyState
              icon={ShieldOff}
              title="조직 관리 권한이 없습니다"
              description="이 페이지는 SUPER_ADMIN/ADMIN만 접근할 수 있습니다."
            />
          </div>
        );
      }
      return (
        <div className="px-3 py-4">
          <EmptyState
            icon={AlertTriangle}
            title="조직 트리를 불러오지 못했습니다"
            description={err?.message}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => treeQuery.refetch()}
              >
                재시도
              </Button>
            }
          />
        </div>
      );
    }
    if (flatList.length === 0) {
      return (
        <div className="px-3 py-4">
          <EmptyState
            icon={Building2}
            title="등록된 조직이 없습니다"
            action={
              <Button
                size="sm"
                onClick={() => setCreateOpen({ parentId: null })}
              >
                <Plus className="h-3.5 w-3.5" />
                최상위 조직 추가
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <OrganizationTree
        nodes={tree}
        selectedId={orgId}
        onSelect={(id) => selectOrg(id)}
        defaultExpanded={tree.map((n) => n.id)}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />

      <SubSidebar
        title="조직 트리"
        footer={
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-center"
            onClick={() => setCreateOpen({ parentId: null })}
          >
            <Plus className="h-3.5 w-3.5" />
            최상위 조직 추가
          </Button>
        }
      >
        {renderTreeColumn()}
      </SubSidebar>

      <OrganizationDetailPanel
        org={selectedOrg}
        siblings={siblings}
        childrenList={childrenList}
        breadcrumb={breadcrumb}
        members={membersQuery.data?.data}
        membersTotal={membersQuery.data?.meta?.total ?? selectedOrg?.userCount}
        membersLoading={membersQuery.isPending && !!orgId}
        membersUnsupported={membersUnsupported}
        onEdit={() => selectedOrg && setEditTarget(selectedOrg)}
        onCreateChild={() =>
          selectedOrg && setCreateOpen({ parentId: selectedOrg.id })
        }
        onDelete={() => selectedOrg && setDeleteTarget(selectedOrg)}
        onMoveUp={handleMoveUp}
        onMoveDown={handleMoveDown}
        onSelectChild={(id) => selectOrg(id)}
      />

      {/* Dialogs */}
      {createOpen ? (
        <OrgEditDialog
          mode="create"
          parentId={createOpen.parentId}
          organizations={flatList}
          open
          onClose={() => setCreateOpen(null)}
          onSubmit={handleCreate}
        />
      ) : null}

      {editTarget ? (
        <OrgEditDialog
          mode="edit"
          target={editTarget}
          organizations={flatList}
          open
          onClose={() => setEditTarget(null)}
          onSubmit={handleEdit}
        />
      ) : null}

      {deleteTarget ? (
        <OrgDeleteDialog
          target={deleteTarget}
          open
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await deleteMutation.mutateAsync(deleteTarget);
            setDeleteTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Map common ApiError variants to a friendly toast description. */
function friendly(err: ApiError): string {
  switch (err.status) {
    case 403:
      return '권한이 부족합니다.';
    case 404:
      return '대상을 찾을 수 없습니다.';
    case 409:
      return '동일한 이름이 이미 존재하거나 충돌이 발생했습니다.';
  }
  if (err.code === 'E_RATE_LIMIT') {
    return '요청 빈도 제한에 걸렸습니다. 잠시 후 다시 시도하세요.';
  }
  return err.message;
}
