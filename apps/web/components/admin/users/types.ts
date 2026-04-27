import { z } from 'zod';

/**
 * R29 U-2 — types and zod schemas shared by `<UserManagementTable>` and
 * the 5 dialogs.
 *
 * Wire shape from `GET /api/v1/admin/users` per `_workspace/api_contract.md §4`
 * + `docs/_specs/r29_user_management_and_notifications.md §A.11.1`.
 *
 * The BE list endpoint is being upgraded in the same R29 round to include
 * `lockStatus`, `lockedUntil`, `failedLoginCount`, and `deletedAt`. We accept
 * those as optional/nullable so the FE keeps working if the round merges in
 * any order (BE-first or FE-first).
 */

export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'USER', 'PARTNER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const EMPLOYMENT_TYPES = ['ACTIVE', 'RETIRED', 'PARTNER'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const SECURITY_LEVELS = [1, 2, 3, 4, 5] as const;
export type SecurityLevel = (typeof SECURITY_LEVELS)[number];

export const LOCK_STATUSES = ['NONE', 'LOCKED'] as const;
export type LockStatus = (typeof LOCK_STATUSES)[number];

export const STATUS_FILTERS = ['all', 'active', 'locked', 'inactive'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Item returned from `GET /api/v1/admin/users`. Most fields are optional so
 * the FE keeps rendering even before the BE PATCHes the response with the
 * new R29 columns.
 */
export interface AdminUserListItem {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  organizationId: string | null;
  organization: { id: string; name: string } | null;
  role: UserRole;
  employmentType: EmploymentType;
  securityLevel: SecurityLevel;
  failedLoginCount?: number;
  lockedUntil?: string | null;
  lockStatus?: LockStatus;
  lastLoginAt?: string | null;
  createdAt: string;
  deletedAt?: string | null;
}

// ── Zod: form values ─────────────────────────────────────────────────────
//
// PM-DECISION-2 default — minimum 8 characters. BE (per spec) layers stricter
// rules; FE forwards length only. Higher classes of password are validated
// server-side and surfaced via 400 E_VALIDATION → setError.
const passwordRule = z
  .string()
  .min(8, '8자 이상이어야 합니다.')
  .max(64, '64자 이하여야 합니다.');

export const userCreateSchema = z.object({
  username: z
    .string()
    .min(8, '8~32자')
    .max(32, '8~32자')
    .regex(/^[a-z0-9._-]+$/, '영문 소문자/숫자/`.`/`_`/`-`만 사용할 수 있습니다.'),
  fullName: z.string().min(1, '이름을 입력하세요.').max(40, '40자 이하'),
  email: z
    .string()
    .email('올바른 이메일 형식이 아닙니다.')
    .max(255)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  organizationId: z
    .string()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  role: z.enum(USER_ROLES),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  securityLevel: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
    .or(
      z
        .string()
        .regex(/^[1-5]$/)
        .transform((v) => Number(v) as SecurityLevel),
    ),
  password: passwordRule,
});

/**
 * Edit form: same as create but `password` and `username` are stripped — the
 * username is immutable, the password is reset via a separate dialog.
 */
export const userEditSchema = userCreateSchema
  .omit({ password: true, username: true })
  .extend({
    // Keep username so we can render it (read-only) but never PATCH it.
    username: z.string(),
  });

export type UserCreateValues = z.infer<typeof userCreateSchema>;
export type UserEditValues = z.infer<typeof userEditSchema>;

// ── Zod: password reset dialog ───────────────────────────────────────────
export const passwordResetManualSchema = z.object({
  tempPassword: passwordRule,
});

export type PasswordResetManualValues = z.infer<typeof passwordResetManualSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────

/** True when `lockedUntil` is in the future (BE may instead set lockStatus). */
export function isLocked(user: AdminUserListItem): boolean {
  if (user.lockStatus) return user.lockStatus === 'LOCKED';
  if (!user.lockedUntil) return false;
  const t = Date.parse(user.lockedUntil);
  return Number.isFinite(t) && t > Date.now();
}

/** True when soft-deleted via `deletedAt`. */
export function isInactive(user: AdminUserListItem): boolean {
  return Boolean(user.deletedAt);
}
