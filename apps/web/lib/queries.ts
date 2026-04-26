// React Query keys factory. Centralizes query key construction so cache
// invalidation stays consistent across components.

export const queryKeys = {
  me: () => ['me'] as const,

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
    users: () => ['admin', 'users'] as const,
    organizations: () => ['admin', 'organizations'] as const,
    groups: () => ['admin', 'groups'] as const,
    classes: () => ['admin', 'classes'] as const,
    classAttributes: (classId: string) => ['admin', 'classes', classId, 'attributes'] as const,
    folders: () => ['admin', 'folders'] as const,
    notices: () => ['admin', 'notices'] as const,
    audit: (params: Record<string, unknown> = {}) => ['admin', 'audit', params] as const,
  },

  search: {
    palette: (q: string) => ['search', 'palette', q] as const,
  },
} as const;

export type QueryKeys = typeof queryKeys;
