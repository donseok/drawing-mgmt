/**
 * Document control state — derived from `ObjectState` for display in the
 * search grid and preview panels. Promoted to constants so typo-driven
 * equality bugs are caught at compile time.
 */
import type { ObjectState } from '@/components/object-list/ObjectTable';

export const CONTROL_STATE = {
  WORKING: '작업중',
  REVIEW: '검토중',
  APPROVED: '승인본',
  FIELD: '현장배포본',
} as const;

export type ControlState = (typeof CONTROL_STATE)[keyof typeof CONTROL_STATE];

export function deriveControlState(state: ObjectState): ControlState {
  switch (state) {
    case 'APPROVED':
      return CONTROL_STATE.FIELD;
    case 'IN_APPROVAL':
      return CONTROL_STATE.REVIEW;
    case 'CHECKED_OUT':
      return CONTROL_STATE.WORKING;
    default:
      return CONTROL_STATE.APPROVED;
  }
}
