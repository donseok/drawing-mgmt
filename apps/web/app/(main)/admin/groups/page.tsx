'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { AlertTriangle, Plus, ShieldOff, Users2 } from 'lucide-react';
import { toast } from 'sonner';

import { AdminSidebar } from '@/app/(main)/admin/AdminSidebar';
import { SubSidebar } from '@/components/layout/SubSidebar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';

import { GroupListPanel } from '@/components/admin/groups/GroupListPanel';
import { GroupMembershipMatrix } from '@/components/admin/groups/GroupMembershipMatrix';
import { GroupEditDialog } from '@/components/admin/groups/GroupEditDialog';
import { GroupDeleteDialog } from '@/components/admin/groups/GroupDeleteDialog';
import {
  type AdminGroupListItem,
  type AdminGroupMember,
  type GroupEditValues,
} from '@/components/admin/groups/types';
import {
  type AdminUserListItem,
  type UserRole,
} from '@/components/admin/users/types';

import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

/**
 * /admin/groups — R30 U-4.
 *
 * 3-pane: AdminSidebar / GroupListPanel / GroupMembershipMatrix.
 * Member edits are full-replace via PUT /api/v1/admin/groups/:id/members.
 * Layer 2 unsaved-guard intercepts list clicks; Layer 3 is the matrix's
 * beforeunload listener.
 */

interface UsersListEnvelope {
  data: AdminUserListItem[];
  meta: { nextCursor: string | null };
}

async function fetchCandidateUsers(params: {
  q?: string;
  cursor?: string;
  limit?: number;
}): Promise<UsersListEnvelope> {
  const url = new URL('/api/v1/admin/users', window.location.origin);
  if (params.q) url.searchParams.set('q', params.q);
  if (params.cursor) url.searchParams.set('cursor', params.cursor);
  url.searchParams.set('limit', String(params.limit ?? 50));
  const res = await fetch(url.toString(), {
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
    const env = (parsed as { error?: { code?: string; message?: string } } | undefined)
      ?.error;
    throw new ApiError(env?.message ?? `Request failed (${res.status})`, {
      code: env?.code,
      status: res.status,
    });
  }
  const env = parsed as UsersListEnvelope & { ok?: boolean };
  return { data: env.data, meta: env.meta ?? { nextCursor: null } };
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function GroupsAdminPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const groupId = searchParams?.get('groupId') ?? null;

  // ── Group list query ─────────────────────────────────────────────────
  const groupsQuery = useQuery<AdminGroupListItem[], ApiError>({
    queryKey: queryKeys.admin.groupsList(),
    queryFn: () => api.get<AdminGroupListItem[]>('/api/v1/admin/groups'),
    staleTime: 30_000,
  });

  // ── Members for selected group ───────────────────────────────────────
  const membersQuery = useQuery<AdminGroupMember[], ApiError>({
    queryKey: queryKeys.admin.groupMembers(groupId ?? '__none__'),
    queryFn: () =>
      api.get<AdminGroupMember[]>(`/api/v1/admin/groups/${groupId}/members`),
    enabled: !!groupId,
    staleTime: 0,
  });

  // ── Candidate users (cursor) — share R29's `usersList` cache key ─────
  const initialQ = searchParams?.get('q') ?? '';
  const [q, setQ] = React.useState(initialQ);
  const debouncedQ = useDebouncedValue(q.trim(), 400);

  React.useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() ?? '');
    if (debouncedQ) sp.set('q', debouncedQ);
    else sp.delete('q');
    const qs = sp.toString();
    router.replace(qs ? `/admin/groups?${qs}` : '/admin/groups');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const candidatesQuery = useInfiniteQuery<UsersListEnvelope, ApiError>({
    queryKey: queryKeys.admin.usersList({ q: debouncedQ }),
    queryFn: ({ pageParam }) =>
      fetchCandidateUsers({
        q: debouncedQ || undefined,
        cursor: pageParam as string | undefined,
        limit: 50,
      }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    staleTime: 30_000,
    enabled: !!groupId,
  });
  const candidateUsers: AdminUserListItem[] = React.useMemo(
    () => candidatesQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [candidatesQuery.data],
  );

  const [roleFilter, setRoleFilter] = React.useState<'all' | UserRole>('all');
  const [membersOnly, setMembersOnly] = React.useState(false);
  const [groupSearch, setGroupSearch] = React.useState('');

  // ── Selected group ───────────────────────────────────────────────────
  const selectedGroup = React.useMemo(
    () =>
      groupId
        ? (groupsQuery.data ?? []).find((g) => g.id === groupId) ?? null
        : null,
    [groupsQuery.data, groupId],
  );

  // ── URL helpers ──────────────────────────────────────────────────────
  const selectGroupUrl = React.useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? '');
      if (id) sp.set('groupId', id);
      else sp.delete('groupId');
      const qs = sp.toString();
      router.replace(qs ? `/admin/groups?${qs}` : '/admin/groups');
    },
    [router, searchParams],
  );

  // ── Unsaved guard (Layer 2) ──────────────────────────────────────────
  const [dirtyCount, setDirtyCount] = React.useState(0);
  const [pendingGroupId, setPendingGroupId] = React.useState<string | null>(
    null,
  );

  const handleSelectGroup = React.useCallback(
    (id: string) => {
      if (dirtyCount > 0 && id !== groupId) {
        setPendingGroupId(id);
        return;
      }
      selectGroupUrl(id);
    },
    [dirtyCount, groupId, selectGroupUrl],
  );

  const navigateToPending = () => {
    if (!pendingGroupId) return;
    selectGroupUrl(pendingGroupId);
    setPendingGroupId(null);
    setDirtyCount(0);
  };

  // ── Mutations ────────────────────────────────────────────────────────
  const invalidateGroups = React.useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.admin.groups(),
    });
  }, [queryClient]);

  const createMutation = useMutation<
    AdminGroupListItem,
    ApiError,
    GroupEditValues
  >({
    mutationFn: (body) =>
      api.post<AdminGroupListItem>('/api/v1/admin/groups', body),
    onSuccess: (data) => {
      toast.success(`그룹이 추가되었습니다 (${data.name})`);
      invalidateGroups();
      selectGroupUrl(data.id);
    },
    onError: (err) => {
      if (err.code === 'E_VALIDATION' || err.code === 'E_CONFLICT') return;
      toast.error('그룹 추가 실패', { description: friendly(err) });
    },
  });

  const updateMutation = useMutation<
    AdminGroupListItem,
    ApiError,
    { id: string; body: GroupEditValues }
  >({
    mutationFn: ({ id, body }) =>
      api.patch<AdminGroupListItem>(`/api/v1/admin/groups/${id}`, body),
    onSuccess: () => {
      toast.success('변경사항이 저장되었습니다');
      invalidateGroups();
    },
    onError: (err) => {
      if (err.code === 'E_VALIDATION' || err.code === 'E_CONFLICT') return;
      toast.error('수정 실패', { description: friendly(err) });
    },
  });

  const deleteMutation = useMutation<unknown, ApiError, AdminGroupListItem>({
    mutationFn: (g) => api.delete(`/api/v1/admin/groups/${g.id}`),
    onSuccess: (_d, g) => {
      toast.success(`그룹이 삭제되었습니다 (${g.name})`);
      invalidateGroups();
      if (groupId === g.id) selectGroupUrl(null);
    },
    onError: (err) =>
      toast.error('삭제 실패', { description: friendly(err) }),
  });

  const saveMembersMutation = useMutation<
    { memberCount?: number },
    ApiError,
    { id: string; userIds: string[] }
  >({
    mutationFn: ({ id, userIds }) =>
      api.put<{ memberCount?: number }>(
        `/api/v1/admin/groups/${id}/members`,
        { userIds },
      ),
    onSuccess: (data, vars) => {
      toast.success(
        `멤버가 저장되었습니다 (${data?.memberCount ?? vars.userIds.length}명)`,
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.groupMembers(vars.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.groupsList(),
      });
    },
    onError: (err) => {
      if (err.code === 'E_VALIDATION') {
        toast.warning(err.message ?? '저장 실패', {
          description: '한 번에 최대 1000명까지 저장할 수 있습니다.',
        });
        return;
      }
      if (err.status === 404) {
        toast.error('그룹이 삭제되었습니다', {
          description: '목록을 새로고침합니다.',
        });
        invalidateGroups();
        return;
      }
      if (err.status === 409) {
        toast.error('저장 실패', {
          description:
            '선택된 사용자 중 일부가 비활성 상태입니다. 새로고침 후 다시 시도하세요.',
        });
        return;
      }
      toast.error('저장 실패', { description: friendly(err) });
    },
  });

  // ── Dialog state ─────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<AdminGroupListItem | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] =
    React.useState<AdminGroupListItem | null>(null);

  // ── Render ───────────────────────────────────────────────────────────
  const renderListColumn = (): React.ReactNode => {
    if (groupsQuery.isPending) {
      return (
        <div className="space-y-2 p-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      );
    }
    if (groupsQuery.isError) {
      const err = groupsQuery.error;
      if (err && err.status === 403) {
        return (
          <div className="px-3 py-4">
            <EmptyState
              icon={ShieldOff}
              title="그룹 관리 권한이 없습니다"
              description="이 페이지는 SUPER_ADMIN/ADMIN만 접근할 수 있습니다."
            />
          </div>
        );
      }
      return (
        <div className="px-3 py-4">
          <EmptyState
            icon={AlertTriangle}
            title="그룹 목록을 불러오지 못했습니다"
            description={err?.message}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => groupsQuery.refetch()}
              >
                재시도
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <GroupListPanel
        groups={groupsQuery.data ?? []}
        selectedId={groupId}
        onSelect={handleSelectGroup}
        onEdit={setEditTarget}
        onDelete={setDeleteTarget}
        searchValue={groupSearch}
        onSearchChange={setGroupSearch}
      />
    );
  };

  const renderMatrix = (): React.ReactNode => {
    if (!selectedGroup) {
      return (
        <div className="flex flex-1 items-center justify-center p-10">
          <EmptyState
            icon={Users2}
            title="왼쪽 목록에서 그룹을 선택해 멤버를 편집하세요"
            description="좌측에서 그룹을 선택하면 사용자 매트릭스가 열립니다."
          />
        </div>
      );
    }
    if (membersQuery.isError) {
      return (
        <div className="flex flex-1 items-center justify-center p-10">
          <EmptyState
            icon={AlertTriangle}
            title="멤버를 불러오지 못했습니다"
            description={membersQuery.error?.message}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => membersQuery.refetch()}
              >
                재시도
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <GroupMembershipMatrix
        group={selectedGroup}
        initialMembers={membersQuery.data ?? []}
        candidateUsers={candidateUsers}
        onLoadMore={() => candidatesQuery.fetchNextPage()}
        hasMore={!!candidatesQuery.hasNextPage}
        loadingMore={candidatesQuery.isFetchingNextPage}
        loading={membersQuery.isPending || candidatesQuery.isPending}
        q={q}
        onChangeQ={setQ}
        roleFilter={roleFilter}
        onChangeRole={setRoleFilter}
        membersOnly={membersOnly}
        onChangeMembersOnly={setMembersOnly}
        onSave={async (userIds) => {
          await saveMembersMutation.mutateAsync({
            id: selectedGroup.id,
            userIds,
          });
        }}
        onDirtyCountChange={setDirtyCount}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />

      <SubSidebar
        title="그룹 목록"
        footer={
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-center"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            그룹 추가
          </Button>
        }
      >
        {renderListColumn()}
      </SubSidebar>

      {renderMatrix()}

      {/* Dialogs */}
      <GroupEditDialog
        mode="create"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (values) => {
          await createMutation.mutateAsync(values);
        }}
      />

      {editTarget ? (
        <GroupEditDialog
          mode="edit"
          target={editTarget}
          open
          onClose={() => setEditTarget(null)}
          onSubmit={async (values) => {
            await updateMutation.mutateAsync({
              id: editTarget.id,
              body: values,
            });
          }}
        />
      ) : null}

      {deleteTarget ? (
        <GroupDeleteDialog
          target={deleteTarget}
          open
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await deleteMutation.mutateAsync(deleteTarget);
            setDeleteTarget(null);
          }}
        />
      ) : null}

      {/* Layer 2 — intra-page navigation guard */}
      {pendingGroupId ? (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPendingGroupId(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-bg p-5 elevation-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-fg">
              변경사항이 저장되지 않았습니다
            </h3>
            <p className="mt-1 text-sm text-fg-muted">
              {selectedGroup?.name ?? ''} 그룹의 변경 {dirtyCount}건이 사라집니다.
              그룹을 이동할까요?
            </p>
            <p className="mt-2 text-xs text-fg-subtle">
              저장이 필요하면 먼저 [저장] 버튼을 누르세요.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingGroupId(null)}>
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
