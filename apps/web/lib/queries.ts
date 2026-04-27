// React Query keys factory. Centralizes query key construction so cache
// invalidation stays consistent across components.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiError } from '@/lib/api-client';

// R39 — `me` is callable (`queryKeys.me()` → `['me']`) and also exposes a
// nested `mfa()` factory (`queryKeys.me.mfa()` → `['me','mfa']`). The hybrid
// shape is built via `Object.assign` because R28+ callers already depend on
// the bare `me()` form across many files; folding into an object would be a
// drive-by churn.
const meKey = Object.assign(() => ['me'] as const, {
  mfa: () => ['me', 'mfa'] as const,
});

export const queryKeys = {
  me: meKey,

  folders: {
    all: () => ['folders'] as const,
    tree: () => ['folders', 'tree'] as const,
    detail: (id: string) => ['folders', 'detail', id] as const,
  },

  objects: {
    all: () => ['objects'] as const,
    list: (params: Record<string, unknown> = {}) => ['objects', 'list', params] as const,
    detail: (id: string) => ['objects', 'detail', id] as const,
    versions: (id: string) => ['objects', id, 'versions'] as const,
    activity: (id: string) => ['objects', id, 'activity'] as const,
    // R3c — per-object approval feed (current + history) used by the
    // detail page's 결재 탭. Distinct from `approvals.*` which scopes to
    // the global "내 결재함" lists.
    approvals: (id: string) => ['objects', id, 'approvals'] as const,
    links: (id: string) => ['objects', id, 'links'] as const,
  },

  approvals: {
    all: () => ['approvals'] as const,
    list: (box: string) => ['approvals', 'list', box] as const,
    detail: (id: string) => ['approvals', 'detail', id] as const,
    counts: () => ['approvals', 'counts'] as const,
  },

  lobby: {
    all: () => ['lobby'] as const,
    list: (box?: string) => ['lobby', 'list', box ?? 'received'] as const,
    detail: (id: string) => ['lobby', 'detail', id] as const,
  },

  workspace: {
    home: () => ['workspace', 'home'] as const,
    favorites: () => ['workspace', 'favorites'] as const,
    activity: () => ['workspace', 'activity'] as const,
  },

  notifications: {
    all: () => ['notifications'] as const,
    // R29 — list keyed by filter so `전체` and `읽지 않음` tabs cache
    // separately. `unreadCount` lives at the same root for invalidation.
    list: (params: { unreadOnly?: boolean } = {}) =>
      ['notifications', 'list', params] as const,
    unreadCount: () => ['notifications', 'unread-count'] as const,
  },

  // R7 — workspace personalization. `list` keys by `type` so toggling a
  // single kind doesn't invalidate the other.
  pins: {
    all: () => ['pins'] as const,
    list: (type?: 'folder' | 'object') =>
      ['pins', 'list', type ?? 'all'] as const,
  },

  admin: {
    // R39 SEC-4 — npm-audit summary surface. Single key (no params) because
    // the BE caches the audit result for ~15min and admin only triggers a
    // re-run via a dedicated POST mutation. The "지금 검사" button invalidates
    // this same key on settle so the panel refreshes once the new run lands.
    securityAudit: () => ['admin', 'security', 'audit'] as const,
    // R29 U-2 — admin/users list & detail. List is `useInfiniteQuery` keyed
    // by `q` (cursor lives in pageParam). Detail is by id for future single-
    // user pages; both invalidate together off the `users` root.
    users: () => ['admin', 'users'] as const,
    usersList: (params: { q?: string } = {}) =>
      ['admin', 'users', 'list', params] as const,
    userDetail: (id: string) => ['admin', 'users', 'detail', id] as const,
    organizations: () => ['admin', 'organizations'] as const,
    // R30 U-3 — admin organization tree. Flat list from BE; FE composes the
    // tree. All org mutations (create/patch/delete/reorder) invalidate this
    // single key so the tree re-syncs.
    organizationsTree: () => ['admin', 'organizations', 'tree'] as const,
    organizationMembers: (orgId: string, params: { limit?: number } = {}) =>
      ['admin', 'organizations', orgId, 'members', params] as const,
    groups: () => ['admin', 'groups'] as const,
    // R30 U-4 — group list + per-group member set. The candidate user pool
    // for the membership matrix shares the existing `usersList` cache (same
    // endpoint), so no separate key is needed.
    groupsList: () => ['admin', 'groups', 'list'] as const,
    groupMembers: (groupId: string) =>
      ['admin', 'groups', groupId, 'members'] as const,
    classes: () => ['admin', 'classes'] as const,
    classAttributes: (classId: string) => ['admin', 'classes', classId, 'attributes'] as const,
    folders: () => ['admin', 'folders'] as const,
    notices: () => ['admin', 'notices'] as const,
    audit: (params: Record<string, unknown> = {}) => ['admin', 'audit', params] as const,
    // R28 U-5 — folder permission matrix. Keyed by folderId so a PUT on one
    // folder doesn't invalidate other folders the admin recently inspected.
    folderPermissions: (folderId: string) =>
      ['admin', 'folder-permissions', folderId] as const,
    // R28 U-5 — picker search. The picker lives in PrincipalPicker; key
    // includes type+q so React Query caches each typed prefix separately.
    principals: (params: { type: 'USER' | 'ORG' | 'GROUP'; q: string }) =>
      ['admin', 'principals', params] as const,
    // R28 V-INF-4 — conversion job feed. The 5-second polling refetches just
    // this key; retry mutations invalidate it on settle.
    conversions: (params: { status?: string; cursor?: string } = {}) =>
      ['admin', 'conversions', 'jobs', params] as const,
    // R33 D-5 — backup history. Polled (5s) only when at least one row is
    // RUNNING. `kind` is an optional filter (POSTGRES/FILES); `cursor` is the
    // server-issued opaque pagination token.
    backups: (params: { kind?: string; cursor?: string } = {}) =>
      ['admin', 'backups', params] as const,
    // R34 V-INF-1 — storage driver info + stats. Polled at 1 minute (low
    // urgency — driver/config rarely change, stats are aggregate). The
    // connection-test mutation invalidates this same key so the panel refreshes
    // immediately after a manual probe.
    storage: () => ['admin', 'storage'] as const,
    storageInfo: () => ['admin', 'storage', 'info'] as const,
    // R36 V-INF-3 — virus-scan history. Polled at 5s while at least one row is
    // SCANNING (mirrors /admin/conversions). The re-scan mutation invalidates
    // this same root so stats + table refresh in lockstep.
    scans: (params: { status?: string; cursor?: string } = {}) =>
      ['admin', 'scans', params] as const,
  },

  search: {
    palette: (q: string) => ['search', 'palette', q] as const,
  },

  // R31 P-1 — print/PDF conversion job status. Polling lives inside
  // <PrintDialog>; the key is per-jobId so multiple concurrent dialogs
  // (e.g. detail page + search row) share the cache.
  print: {
    all: () => ['print'] as const,
    status: (jobId: string) => ['print', 'status', jobId] as const,
  },
} as const;

export type QueryKeys = typeof queryKeys;

// ──────────────────────────────────────────────────────────────────────────
// Hooks — co-located here when the cache key is the only thing the hook
// shares with the rest of the app. Keep this section small; per-feature
// hooks belong next to the page that owns them.
// ──────────────────────────────────────────────────────────────────────────

/**
 * R39 SEC-4 / R40 — npm-audit summary surface. Both /admin/security cards and
 * any future "보안 뱃지" surface (e.g. global header) read from the same key.
 * Cache TTL is large because the BE caches the audit blob for ~15min and a
 * fresh run only fires from the dedicated [지금 검사] mutation.
 */
export interface AdminSecurityAuditResponse {
  vulnerabilities: { critical: number; high: number; moderate: number; low: number };
  count: number;
  lastChecked: string;
}

export function useAdminSecurityAudit() {
  return useQuery<AdminSecurityAuditResponse, ApiError>({
    queryKey: queryKeys.admin.securityAudit(),
    queryFn: () =>
      api.get<AdminSecurityAuditResponse>('/api/v1/admin/security/audit'),
    // 60s — the BE caches longer; this just keeps idle tab transitions cheap.
    staleTime: 60_000,
    // The mutation drives invalidation; auto-refetch on focus would race a
    // [지금 검사] click and confuse the spinner state.
    refetchOnWindowFocus: false,
    // 503 with `AUDIT_RUN_FAILED` is a real-but-recoverable state; let the
    // page render the error and wire a "다시 시도" button instead of N retries.
    retry: false,
  });
}

/**
 * R40 — [지금 검사] mutation. Posts to the same audit URL (BE invalidates its
 * own cache and re-runs `pnpm audit --json`); on settle we invalidate the
 * shared key so the GET hook above refetches.
 */
export function useRunSecurityAudit() {
  const queryClient = useQueryClient();
  return useMutation<AdminSecurityAuditResponse, ApiError, void>({
    mutationFn: () =>
      api.post<AdminSecurityAuditResponse>('/api/v1/admin/security/audit'),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.securityAudit(),
      });
    },
  });
}
