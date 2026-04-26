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
};

/**
 * Resolve a Korean label for an ActivityLog action. Unknown actions fall back
 * to the raw token so newly added BE actions never crash the UI — they just
 * look ugly until the table is updated.
 */
export function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action;
}
