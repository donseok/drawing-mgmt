import { describe, it, expect } from 'vitest';

import { ACTIVITY_LABELS, activityLabel } from '@/lib/activity-labels';

describe('activityLabel', () => {
  it('maps known OBJECT_* actions to Korean labels', () => {
    expect(activityLabel('OBJECT_CREATE')).toBe('자료 등록');
    expect(activityLabel('OBJECT_DELETE')).toBe('자료 삭제');
    expect(activityLabel('OBJECT_RELEASE')).toBe('결재상신');
  });

  it('maps known USER_* admin actions', () => {
    expect(activityLabel('USER_CREATE')).toBe('사용자 생성');
    expect(activityLabel('USER_UNLOCK')).toBe('계정 잠금 해제');
    expect(activityLabel('USER_PASSWORD_RESET')).toBe('비밀번호 초기화');
  });

  it('maps APPROVAL_* derived notification actions', () => {
    expect(activityLabel('APPROVAL_REQUEST')).toBe('결재 요청');
    expect(activityLabel('APPROVAL_APPROVE')).toBe('결재 승인됨');
    expect(activityLabel('APPROVAL_REJECT')).toBe('결재 반려됨');
  });

  it('falls back to the raw token for unknown action codes', () => {
    // Unknown codes round-trip so newly-added BE actions never crash the UI;
    // they just look ugly until ACTIVITY_LABELS is updated.
    expect(activityLabel('FUTURE_ACTION_NOT_YET_MAPPED')).toBe(
      'FUTURE_ACTION_NOT_YET_MAPPED',
    );
    expect(activityLabel('')).toBe('');
  });

  it('ACTIVITY_LABELS table exposes the full set as a plain object lookup', () => {
    // Sanity that the export matches activityLabel() for sampled keys.
    expect(ACTIVITY_LABELS.LOGIN).toBe('로그인');
    expect(ACTIVITY_LABELS.PRINT_REQUEST).toBe('인쇄 요청');
    expect(ACTIVITY_LABELS.GROUP_MEMBER_UPDATE).toBe('그룹 멤버 변경');
  });
});
