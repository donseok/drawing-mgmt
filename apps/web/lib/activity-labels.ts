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
  // R48 / FIND-018 — explicit success/fail rows. `LOGIN` (legacy) is kept
  // for backwards compat with any older rows; new writes always use
  // LOGIN_SUCCESS or LOGIN_FAIL so the audit table can group cleanly.
  LOGIN_SUCCESS: '로그인 성공',
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
  // R48 / FIND-019 — per-attachment download / preview / print audit. We
  // intentionally omit a thumbnail action: list pages render 50–100 thumbs
  // per page, so logging would drown the audit table for negligible
  // security gain.
  OBJECT_DOWNLOAD: '자료 다운로드',
  OBJECT_PREVIEW: '자료 미리보기',
  OBJECT_PRINT: '자료 인쇄',
  // R31 — admin retry on a generic ConversionJob (already used by R28's
  // /api/v1/admin/conversions/jobs/{id}/retry).
  CONVERSION_RETRY: '변환 재시도',
  // R33 / D-5 — admin manually triggered a backup run.
  BACKUP_RUN: '백업 실행',
  // R33 / D-5 — admin downloaded a completed backup artifact.
  BACKUP_DOWNLOAD: '백업 다운로드',
  // R36 / V-INF-3 — admin re-enqueued an INFECTED/FAILED virus scan.
  VIRUS_SCAN_RETRY: '바이러스 재스캔',
  // R41 / A — admin re-enqueued a FAILED/SKIPPED PDF body-text extraction.
  PDF_EXTRACT_RETRY: 'PDF 본문 재추출',
  // R-MARKUP / V-6 — viewer measurement markup save/share lifecycle. The
  // attachment id + markup id ride in `metadata`; we don't link to an
  // ObjectEntity directly because Markup hangs off Attachment, not Object,
  // and most consumers want the file/viewer route anyway.
  MARKUP_SAVE: '마크업 저장',
  MARKUP_UPDATE: '마크업 수정',
  MARKUP_DELETE: '마크업 삭제',
};

/**
 * Resolve a Korean label for an ActivityLog action. Unknown actions fall back
 * to the raw token so newly added BE actions never crash the UI — they just
 * look ugly until the table is updated.
 */
export function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action;
}
