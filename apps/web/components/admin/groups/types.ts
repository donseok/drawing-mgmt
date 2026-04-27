import { z } from 'zod';
import type { UserRole } from '@/components/admin/users/types';

/**
 * R30 U-4 — types and zod schemas shared by `<GroupListPanel>`,
 * `<GroupMembershipMatrix>`, `<GroupEditDialog>`, `<GroupDeleteDialog>`.
 *
 * Wire shape from `_workspace/api_contract.md §4` + designer §B.11.
 */

export interface AdminGroupListItem {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt?: string;
}

export interface AdminGroupMember {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  organizationId: string | null;
  organizationName?: string | null;
  role: UserRole;
  deletedAt?: string | null;
}

// ── Zod: form values ─────────────────────────────────────────────────────

export const groupEditSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '그룹 이름을 입력하세요.')
    .max(50, '50자 이하여야 합니다.'),
  description: z
    .string()
    .max(200, '200자 이하여야 합니다.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export type GroupEditValues = z.infer<typeof groupEditSchema>;

// ── Membership row model (FE form state, NOT wire) ───────────────────────
export interface MembershipRow {
  user: {
    id: string;
    username: string;
    fullName: string;
    role: UserRole;
    organizationId: string | null;
    organizationName?: string | null;
    deletedAt?: string | null;
  };
  origin: boolean;
  current: boolean;
  state: 'normal' | 'added' | 'removed';
}

export function deriveRowState(origin: boolean, current: boolean): MembershipRow['state'] {
  if (origin && !current) return 'removed';
  if (!origin && current) return 'added';
  return 'normal';
}
