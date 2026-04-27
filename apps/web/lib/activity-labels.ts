// Single source of truth for ActivityLog.action → 한국어 표시 라벨 매핑.
//
// Used by:
//   - GET /api/v1/notifications  (BE) — derives notification titles
//   - apps/web/app/(main)/objects/[id]/page.tsx (FE) — activity 탭
//
// Adding a new BE action: add it here once and both consumers pick it up.
// Unknown action codes fall back to the raw token via `activityLabel()`.

export const ACTIVITY_LABELS: Record<string, string> = {
  LOGIN: '로그인',
  LOGIN_FAIL: '로그인 실패',
  OBJECT_CREATE: '자료 등록',
  OBJECT_UPDATE: '자료 수정',
  OBJECT_DELETE: '자료 삭제',
  OBJECT_CHECKOUT: '체크아웃',
  OBJECT_CHECKIN: '체크인',
  OBJECT_CANCEL_CHECKOUT: '체크아웃 취소',
  OBJECT_RELEASE: '결재상신',
  OBJECT_APPROVE: '승인',
  OBJECT_REJECT: '반려',
  OBJECT_CANCEL: '결재 취소',
  OBJECT_REVISE: '개정',
  OBJECT_LINK: '연결',
  OBJECT_UNLINK: '연결 해제',
  OBJECT_MOVE: '이동',
  OBJECT_ATTACH: '첨부 추가',
  OBJECT_DETACH: '첨부 제거',
  APPROVE: '결재 승인',
  REJECT: '결재 반려',
  APPROVAL_DEFER: '결재 미루기',
  APPROVAL_RECALL: '결재 회수',
  // R29 — admin actions on users (U-2).
  USER_CREATE: '사용자 생성',
  USER_UPDATE: '사용자 수정',
  USER_DELETE: '사용자 삭제',
  USER_UNLOCK: '계정 잠금 해제',
  USER_PASSWORD_RESET: '비밀번호 초기화',
  // R29 — derived notification types that don't have a 1:1 ActivityLog row.
  APPROVAL_REQUEST: '결재 요청',
  APPROVAL_APPROVE: '결재 승인됨',
  APPROVAL_REJECT: '결재 반려됨',
  LOBBY_REPLY: '협의 답변',
  // R30 — admin CRUD on organizations + groups (U-3, U-4).
  ORG_CREATE: '조직 생성',
  ORG_UPDATE: '조직 수정',
  ORG_DELETE: '조직 삭제',
  GROUP_CREATE: '그룹 생성',
  GROUP_UPDATE: '그룹 수정',
  GROUP_DELETE: '그룹 삭제',
  GROUP_MEMBER_UPDATE: '그룹 멤버 변경',
  // R31 — print/PDF pipeline (P-1) request audit. The actual conversion
  // outcome is tracked via ConversionJob rows; this row is the user-facing
  // "I asked for a printout" log entry.
  PRINT_REQUEST: '인쇄 요청',
  // R31 — admin retry on a generic ConversionJob (already used by R28's
  // /api/v1/admin/conversions/jobs/{id}/retry).
  CONVERSION_RETRY: '변환 재시도',
};

/**
 * Resolve a Korean label for an ActivityLog action. Unknown actions fall back
 * to the raw token so newly added BE actions never crash the UI — they just
 * look ugly until the table is updated.
 */
export function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action;
}
