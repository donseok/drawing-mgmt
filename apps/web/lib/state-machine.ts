// Object lifecycle state machine — TRD §5.3.
// Server-side enforced; clients must not be trusted with the next state.
//
// Transitions:
//   NEW          ─ checkout       ─→ CHECKED_OUT
//   NEW          ─ checkin        ─→ CHECKED_IN
//   CHECKED_IN   ─ checkout       ─→ CHECKED_OUT
//   CHECKED_OUT  ─ checkin        ─→ CHECKED_IN
//   CHECKED_OUT  ─ cancelCheckout ─→ CHECKED_IN  (self lock only; no version bump)
//   CHECKED_IN   ─ release        ─→ IN_APPROVAL
//   IN_APPROVAL  ─ approve        ─→ APPROVED
//   IN_APPROVAL  ─ reject         ─→ CHECKED_IN
//   IN_APPROVAL  ─ recall         ─→ CHECKED_IN  (requester only)
//   APPROVED     ─ newRevision    ─→ CHECKED_OUT
//   *            ─ delete         ─→ DELETED
//   DELETED      ─ restore        ─→ (previous state — handled by caller)

import { ObjectState } from '@prisma/client';

export type ObjectAction =
  | 'checkout'
  | 'checkin'
  | 'cancelCheckout'
  | 'release'
  | 'approve'
  | 'reject'
  | 'recall'
  | 'newRevision'
  | 'delete'
  | 'restore';

interface TransitionContext {
  /** Current locker (if any) */
  lockedById?: string | null;
  /** Acting user id */
  userId: string;
}

/** Allowed (from, action) → to map. */
const ALLOWED: Record<ObjectAction, Partial<Record<ObjectState, ObjectState>>> = {
  checkout: {
    [ObjectState.NEW]: ObjectState.CHECKED_OUT,
    [ObjectState.CHECKED_IN]: ObjectState.CHECKED_OUT,
    [ObjectState.APPROVED]: ObjectState.CHECKED_OUT, // newRevision shorthand
  },
  checkin: {
    [ObjectState.NEW]: ObjectState.CHECKED_IN,
    [ObjectState.CHECKED_OUT]: ObjectState.CHECKED_IN,
  },
  cancelCheckout: {
    [ObjectState.CHECKED_OUT]: ObjectState.CHECKED_IN,
  },
  release: {
    [ObjectState.CHECKED_IN]: ObjectState.IN_APPROVAL,
  },
  approve: {
    [ObjectState.IN_APPROVAL]: ObjectState.APPROVED,
  },
  reject: {
    [ObjectState.IN_APPROVAL]: ObjectState.CHECKED_IN,
  },
  recall: {
    [ObjectState.IN_APPROVAL]: ObjectState.CHECKED_IN,
  },
  newRevision: {
    [ObjectState.APPROVED]: ObjectState.CHECKED_OUT,
  },
  delete: {
    [ObjectState.NEW]: ObjectState.DELETED,
    [ObjectState.CHECKED_IN]: ObjectState.DELETED,
    [ObjectState.APPROVED]: ObjectState.DELETED,
    [ObjectState.CHECKED_OUT]: ObjectState.DELETED, // owner only — caller must enforce
  },
  restore: {
    [ObjectState.DELETED]: ObjectState.NEW, // simplification: caller may override
  },
};

export interface TransitionResult {
  ok: boolean;
  /** Resolved next state when ok=true */
  next?: ObjectState;
  /** When ok=false, machine-readable reason */
  reason?:
    | 'INVALID_TRANSITION'
    | 'NOT_LOCKED_BY_USER'
    | 'ALREADY_LOCKED';
  message?: string;
}

/**
 * Validate a state transition. Does not mutate; pure function.
 * Lock ownership rules:
 *   - checkin        from CHECKED_OUT: caller must own lockedById.
 *   - cancelCheckout from CHECKED_OUT: caller must own lockedById (self lock only).
 *   - checkout       from CHECKED_IN/NEW/APPROVED: object must not be locked by another user.
 */
export function canTransition(
  from: ObjectState,
  action: ObjectAction,
  ctx: TransitionContext,
): TransitionResult {
  const next = ALLOWED[action]?.[from];
  if (!next) {
    return {
      ok: false,
      reason: 'INVALID_TRANSITION',
      message: `${from} 상태에서 ${action} 작업을 수행할 수 없습니다.`,
    };
  }

  if (action === 'checkin' && from === ObjectState.CHECKED_OUT) {
    if (!ctx.lockedById || ctx.lockedById !== ctx.userId) {
      return {
        ok: false,
        reason: 'NOT_LOCKED_BY_USER',
        message: '본인이 체크아웃한 자료만 체크인할 수 있습니다.',
      };
    }
  }

  if (action === 'cancelCheckout') {
    if (!ctx.lockedById || ctx.lockedById !== ctx.userId) {
      return {
        ok: false,
        reason: 'NOT_LOCKED_BY_USER',
        message: '본인이 체크아웃한 자료만 취소할 수 있습니다.',
      };
    }
  }

  if (action === 'checkout') {
    if (ctx.lockedById && ctx.lockedById !== ctx.userId) {
      return {
        ok: false,
        reason: 'ALREADY_LOCKED',
        message: '다른 사용자가 잠금 중입니다.',
      };
    }
  }

  return { ok: true, next };
}

/** Convenience: list of states that are not deleted. */
export const ACTIVE_STATES: ObjectState[] = [
  ObjectState.NEW,
  ObjectState.CHECKED_OUT,
  ObjectState.CHECKED_IN,
  ObjectState.IN_APPROVAL,
  ObjectState.APPROVED,
];
