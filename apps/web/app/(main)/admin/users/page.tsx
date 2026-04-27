'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { AlertTriangle, Plus, ShieldOff, Users } from 'lucide-react';
import { toast } from 'sonner';

import { AdminSidebar } from '@/app/(main)/admin/AdminSidebar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

import {
  UserManagementTable,
  type UserManagementTableProps,
} from '@/components/admin/users/UserManagementTable';
import { UsersToolbar } from '@/components/admin/users/UsersToolbar';
import { UserFormDialog } from '@/components/admin/users/UserFormDialog';
import { PasswordResetDialog } from '@/components/admin/users/PasswordResetDialog';
import { UserUnlockDialog } from '@/components/admin/users/UserUnlockDialog';
import { UserDeactivateDialog } from '@/components/admin/users/UserDeactivateDialog';
import {
  isInactive,
  isLocked,
  type AdminUserListItem,
  type StatusFilter,
  type UserCreateValues,
  type UserEditValues,
  type UserRole,
} from '@/components/admin/users/types';

/**
 * /admin/users — R29 U-2.
 *
 * Single-pane CRUD: AdminSidebar + (header / toolbar / table / [더 보기]).
 * Row actions open one of 5 dialogs (create/edit/reset-password/unlock/
 * deactivate). Cursor-based infinite scroll via `useInfiniteQuery`; FE-side
 * client filter for `role` and `status` (PM-DECISION-1 default — user count
 * < 200, payload is small).
 *
 * AuthZ: layout-level `(main)/admin/page.tsx` already gates on role; the BE
 * also rejects 403 for non-admin sessions. Both layers are required because
 * the page is a leaf route with no separate guard.
 */

// ── Wire shapes ──────────────────────────────────────────────────────────

interface MeResponse {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
}

interface OrganizationResponse {
  id: string;
  name: string;
}

interface UsersListEnvelope {
  data: AdminUserListItem[];
  meta: { nextCursor: string | null };
}

async function fetchUsers(params: {
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
  // Tolerate both `{ data, meta }` and `{ ok, data, meta }` shapes.
  const env = parsed as UsersListEnvelope & { ok?: boolean };
  return { data: env.data, meta: env.meta ?? { nextCursor: null } };
}

// ── Debounce hook (local, mirrors PrincipalPicker style) ─────────────────
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function UsersAdminPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // ── URL-synced search query (`?q=`). Role/status filters live in component
  //    state to avoid pushing to URL on every dropdown change (PM-DECISION-1).
  const initialQ = searchParams?.get('q') ?? '';
  const [q, setQ] = React.useState(initialQ);
  const debouncedQ = useDebouncedValue(q.trim(), 400);

  React.useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() ?? '');
    if (debouncedQ) sp.set('q', debouncedQ);
    else sp.delete('q');
    const qs = sp.toString();
    router.replace(qs ? `/admin/users?${qs}` : '/admin/users');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const [roleFilter, setRoleFilter] = React.useState<'all' | UserRole>('all');
  // Default = active. The "비활성" rows are hidden until the admin opts in.
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('active');

  const handleReset = () => {
    setQ('');
    setRoleFilter('all');
    setStatusFilter('active');
  };

  // ── Current session — used for self-row marker, self-demotion guard,
  //    SUPER_ADMIN protection. We share the cache with NavRail/Header.
  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: queryKeys.me(),
    queryFn: () => api.get<MeResponse>('/api/v1/me'),
    staleTime: 60_000,
  });

  // ── Organizations — for the form dialog's <Select>. Falls back to []
  //    so the form still renders if the endpoint 403s for some reason.
  const orgsQuery = useQuery<OrganizationResponse[], ApiError>({
    queryKey: queryKeys.admin.organizations(),
    queryFn: () => api.get<OrganizationResponse[]>('/api/v1/admin/organizations'),
    staleTime: 5 * 60_000,
  });

  // ── List query — `useInfiniteQuery` with cursor pagination. Refetched on
  //    `q` change (debounced).
  const listQuery = useInfiniteQuery<UsersListEnvelope, ApiError>({
    queryKey: queryKeys.admin.usersList({ q: debouncedQ }),
    queryFn: ({ pageParam }) =>
      fetchUsers({
        q: debouncedQ || undefined,
        cursor: pageParam as string | undefined,
        limit: 50,
      }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const allRows: AdminUserListItem[] = React.useMemo(
    () => listQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [listQuery.data],
  );

  // ── FE-side filters (PM-DECISION-1). Role is straight equality; status
  //    branches on locked / deletedAt / employmentType.
  const filteredRows = React.useMemo(() => {
    return allRows.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      switch (statusFilter) {
        case 'all':
          return true;
        case 'active':
          // Active = not soft-deleted AND not locked. Hide inactive by default.
          return !isInactive(u) && !isLocked(u);
        case 'locked':
          return isLocked(u) && !isInactive(u);
        case 'inactive':
          return isInactive(u);
      }
    });
  }, [allRows, roleFilter, statusFilter]);

  // ── Dialog targets ───────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<AdminUserListItem | null>(null);
  const [unlockTarget, setUnlockTarget] = React.useState<AdminUserListItem | null>(
    null,
  );
  const [resetTarget, setResetTarget] = React.useState<AdminUserListItem | null>(
    null,
  );
  const [deactivateTarget, setDeactivateTarget] =
    React.useState<AdminUserListItem | null>(null);

  // ── Mutations ────────────────────────────────────────────────────────
  // R29 frontend.md guidance: per-action mutation hooks are simpler than a
  // factory here because the page state is local and each dialog has its
  // own loading lifecycle.
  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
  }, [queryClient]);

  const createMutation = useMutation<
    AdminUserListItem,
    ApiError,
    UserCreateValues
  >({
    mutationFn: (values) => api.post<AdminUserListItem>('/api/v1/admin/users', values),
    onSuccess: (_data, vars) => {
      toast.success(`사용자가 추가되었습니다 (${vars.username})`);
      invalidate();
    },
    onError: (err) => {
      // Field/conflict errors are handled inside the dialog (it surfaces
      // them inline). Surface only non-recoverable variants here.
      if (err.code === 'E_VALIDATION' || err.code === 'E_CONFLICT') return;
      toast.error('사용자 추가 실패', { description: friendly(err) });
    },
  });

  const updateMutation = useMutation<
    AdminUserListItem,
    ApiError,
    { id: string; values: UserEditValues }
  >({
    mutationFn: ({ id, values }) =>
      api.patch<AdminUserListItem>(`/api/v1/admin/users/${id}`, values),
    onSuccess: () => {
      toast.success('변경사항이 저장되었습니다');
      invalidate();
    },
    onError: (err) => {
      if (err.code === 'E_VALIDATION' || err.code === 'E_CONFLICT') return;
      toast.error('수정 실패', { description: friendly(err) });
    },
  });

  const unlockMutation = useMutation<unknown, ApiError, AdminUserListItem>({
    mutationFn: (user) =>
      api.post(`/api/v1/admin/users/${user.id}/unlock`, undefined),
    onSuccess: (_d, user) => {
      toast.success(`잠금이 해제되었습니다 (${user.username})`);
      invalidate();
    },
    onError: (err) => toast.error('잠금 해제 실패', { description: friendly(err) }),
  });

  const resetManualMutation = useMutation<
    unknown,
    ApiError,
    { id: string; tempPassword: string }
  >({
    mutationFn: ({ id, tempPassword }) =>
      api.post(`/api/v1/admin/users/${id}/reset-password`, { tempPassword }),
    onSuccess: () => {
      toast.success('비밀번호가 설정되었습니다');
      invalidate();
    },
    onError: (err) =>
      toast.error('비밀번호 리셋 실패', { description: friendly(err) }),
  });

  const resetGenerateMutation = useMutation<
    { tempPassword: string },
    ApiError,
    { id: string }
  >({
    mutationFn: ({ id }) =>
      api.post<{ tempPassword: string }>(
        `/api/v1/admin/users/${id}/reset-password`,
        { generate: true },
      ),
    onSuccess: () => invalidate(),
    onError: (err) =>
      toast.error('비밀번호 자동 생성 실패', { description: friendly(err) }),
  });

  const deactivateMutation = useMutation<unknown, ApiError, AdminUserListItem>({
    mutationFn: (user) => api.delete(`/api/v1/admin/users/${user.id}`),
    onSuccess: (_d, user) => {
      toast.success(`비활성화되었습니다 (${user.username})`);
      invalidate();
    },
    onError: (err) => toast.error('비활성화 실패', { description: friendly(err) }),
  });

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleCreate = React.useCallback(
    async (values: UserCreateValues | UserEditValues) => {
      // create-mode dialogs always send UserCreateValues
      await createMutation.mutateAsync(values as UserCreateValues);
    },
    [createMutation],
  );

  const handleEdit = React.useCallback(
    async (values: UserCreateValues | UserEditValues) => {
      if (!editTarget) return;
      // Edit-only fields are passed; the dialog already strips username
      // (immutable) + password (separate dialog). If the admin demoted
      // themselves, layout-level redirect handles the guard on next nav.
      const editValues = values as UserEditValues;
      await updateMutation.mutateAsync({
        id: editTarget.id,
        values: {
          fullName: editValues.fullName,
          email: editValues.email,
          organizationId: editValues.organizationId,
          role: editValues.role,
          employmentType: editValues.employmentType,
          securityLevel: editValues.securityLevel,
        } as UserEditValues,
      });
      // PM-DECISION-3 default: rely on router.refresh() then layout-guards.
      if (editTarget.id === meQuery.data?.id && editValues.role !== editTarget.role) {
        router.refresh();
      }
    },
    [editTarget, updateMutation, meQuery.data?.id, router],
  );

  // ── Empty-state branches ─────────────────────────────────────────────
  const isFiltered =
    debouncedQ.length > 0 || roleFilter !== 'all' || statusFilter !== 'active';

  const renderBody = (): React.ReactNode => {
    if (listQuery.isPending || meQuery.isPending) {
      return (
        <UserManagementTable
          rows={[]}
          loading
          currentSelfId={meQuery.data?.id ?? '__loading__'}
          currentSelfRole={meQuery.data?.role ?? 'USER'}
          {...stubHandlers}
        />
      );
    }
    if (listQuery.isError) {
      const err = listQuery.error;
      if (err && err.status === 403) {
        return (
          <EmptyState
            icon={ShieldOff}
            title="사용자 관리 권한이 없습니다"
            description="이 페이지는 SUPER_ADMIN/ADMIN만 접근할 수 있습니다."
          />
        );
      }
      return (
        <EmptyState
          icon={AlertTriangle}
          title="사용자 목록을 불러오지 못했습니다"
          description={err?.message}
          action={
            <Button size="sm" variant="outline" onClick={() => listQuery.refetch()}>
              재시도
            </Button>
          }
        />
      );
    }
    if (filteredRows.length === 0) {
      return (
        <EmptyState
          icon={Users}
          title={
            isFiltered
              ? '조건에 맞는 사용자가 없습니다'
              : '사용자가 아직 등록되지 않았습니다'
          }
          action={
            isFiltered ? (
              <Button size="sm" variant="outline" onClick={handleReset}>
                필터 초기화
              </Button>
            ) : (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                사용자 추가
              </Button>
            )
          }
        />
      );
    }
    if (!meQuery.data) {
      // The list loaded but session didn't — fall through to a generic
      // table so the admin can still see rows. Disable inline actions by
      // routing them to no-ops with a toast.
      return (
        <UserManagementTable
          rows={filteredRows}
          currentSelfId="__unknown__"
          currentSelfRole="USER"
          {...stubHandlers}
        />
      );
    }
    return (
      <UserManagementTable
        rows={filteredRows}
        currentSelfId={meQuery.data.id}
        currentSelfRole={meQuery.data.role}
        onEdit={setEditTarget}
        onUnlock={setUnlockTarget}
        onResetPassword={setResetTarget}
        onDeactivate={setDeactivateTarget}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />

      <section className="flex min-w-0 flex-1 flex-col overflow-auto bg-bg">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
          <span className="text-fg-muted">관리자</span>
          <span className="text-fg-subtle">/</span>
          <span className="font-medium text-fg">사용자</span>
        </div>

        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <div className="app-kicker">Admin Console</div>
            <h1 className="mt-1 text-2xl font-semibold text-fg">사용자</h1>
            <p className="mt-1 text-sm text-fg-muted">계정·역할·서명 관리</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            사용자 추가
          </Button>
        </div>

        <div className="flex flex-col gap-4 p-6">
          <UsersToolbar
            q={q}
            role={roleFilter}
            status={statusFilter}
            onChangeQ={setQ}
            onChangeRole={setRoleFilter}
            onChangeStatus={setStatusFilter}
            onReset={handleReset}
          />

          {renderBody()}

          {listQuery.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => listQuery.fetchNextPage()}
                disabled={listQuery.isFetchingNextPage}
              >
                {listQuery.isFetchingNextPage ? '불러오는 중...' : '더 보기'}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {/* Dialogs */}
      <UserFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        currentSelfId={meQuery.data?.id ?? ''}
        currentSelfRole={meQuery.data?.role ?? 'USER'}
        organizations={orgsQuery.data ?? []}
        onSubmit={handleCreate}
      />

      {editTarget ? (
        <UserFormDialog
          mode="edit"
          open
          onOpenChange={(o) => !o && setEditTarget(null)}
          initial={editTarget}
          currentSelfId={meQuery.data?.id ?? ''}
          currentSelfRole={meQuery.data?.role ?? 'USER'}
          organizations={orgsQuery.data ?? []}
          onSubmit={handleEdit}
        />
      ) : null}

      {unlockTarget ? (
        <UserUnlockDialog
          user={unlockTarget}
          open
          onOpenChange={(o) => !o && setUnlockTarget(null)}
          onConfirm={async () => {
            await unlockMutation.mutateAsync(unlockTarget);
          }}
        />
      ) : null}

      {resetTarget ? (
        <PasswordResetDialog
          user={resetTarget}
          open
          onOpenChange={(o) => !o && setResetTarget(null)}
          onSubmitManual={async (tempPassword) => {
            await resetManualMutation.mutateAsync({
              id: resetTarget.id,
              tempPassword,
            });
          }}
          onSubmitGenerate={async () => {
            return resetGenerateMutation.mutateAsync({ id: resetTarget.id });
          }}
        />
      ) : null}

      {deactivateTarget ? (
        <UserDeactivateDialog
          user={deactivateTarget}
          open
          onOpenChange={(o) => !o && setDeactivateTarget(null)}
          onConfirm={async () => {
            await deactivateMutation.mutateAsync(deactivateTarget);
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
      return '다른 사용자가 동일 대상을 수정했습니다. 새로고침 후 다시 시도하세요.';
  }
  if (err.code === 'E_RATE_LIMIT') {
    return '요청 빈도 제한에 걸렸습니다. 잠시 후 다시 시도하세요.';
  }
  return err.message;
}

/** No-op handler set for skeleton / unauthenticated render branches. */
const stubHandlers: Pick<
  UserManagementTableProps,
  'onEdit' | 'onUnlock' | 'onResetPassword' | 'onDeactivate'
> = {
  onEdit: () => undefined,
  onUnlock: () => undefined,
  onResetPassword: () => undefined,
  onDeactivate: () => undefined,
};
