// Cross-package type definitions

export type ObjectStateName =
  | 'NEW'
  | 'CHECKED_OUT'
  | 'CHECKED_IN'
  | 'IN_APPROVAL'
  | 'APPROVED'
  | 'DELETED';

export type RoleName = 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'PARTNER';

export type PermissionAction =
  | 'VIEW_FOLDER'
  | 'EDIT_FOLDER'
  | 'VIEW'
  | 'EDIT'
  | 'DELETE'
  | 'APPROVE'
  | 'DOWNLOAD'
  | 'PRINT';

export type ChatModeName = 'RAG' | 'RULE';

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
