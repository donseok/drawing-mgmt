// 자료 상태 → UI 색상 매핑 (DESIGN.md §2.1)
export const OBJECT_STATE_COLORS = {
  NEW: 'status-new',
  CHECKED_OUT: 'status-checkedOut',
  CHECKED_IN: 'status-checkedIn',
  IN_APPROVAL: 'status-inApproval',
  APPROVED: 'status-approved',
  REJECTED: 'status-rejected',
  DELETED: 'status-deleted',
} as const;

export const OBJECT_STATE_LABELS = {
  NEW: '신규',
  CHECKED_OUT: '체크아웃',
  CHECKED_IN: '체크인',
  IN_APPROVAL: '결재중',
  APPROVED: '승인',
  REJECTED: '반려',
  DELETED: '폐기',
} as const;

export const MAX_UPLOAD_SIZE = 200 * 1024 * 1024; // 200MB (TRD §8.1)
export const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB (TRD §9)

export const ALLOWED_FILE_EXTENSIONS = [
  '.dwg', '.dxf', '.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff',
  '.xlsx', '.xls', '.docx', '.doc', '.zip',
] as const;

export const SECURITY_LEVELS = [1, 2, 3, 4, 5] as const;
