import { z } from 'zod';

/**
 * R30 U-3 — types and zod schemas shared by `<OrganizationTree>`,
 * `<OrganizationDetailPanel>`, `<OrgEditDialog>`, `<OrgDeleteDialog>`.
 *
 * Wire shape from `GET /api/v1/admin/organizations` per
 * `_workspace/api_contract.md §3.1` + `docs/_specs/r30_org_and_groups.md
 * §A.10`.
 */

/**
 * Item returned from `GET /api/v1/admin/organizations`.
 * BE composes `userCount` (직속만) and `childCount`. `createdAt` is
 * optional because the contract doesn't mandate it (designer spec §A.5.2
 * shows it but BE may add later).
 */
export interface AdminOrganization {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  userCount: number;
  childCount: number;
  createdAt?: string;
}

/** FE-derived tree node (built from the flat list). */
export interface OrganizationTreeNode extends AdminOrganization {
  children: OrganizationTreeNode[];
}

// ── Zod: form values ─────────────────────────────────────────────────────

export const orgEditSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '조직 이름을 입력하세요.')
    .max(50, '50자 이하여야 합니다.'),
  parentId: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : (v ?? null))),
  sortOrder: z
    .union([
      z.number().int().min(0),
      z.string().regex(/^\d+$/),
      z.literal(''),
      z.undefined(),
    ])
    .optional()
    .transform((v) => {
      if (v === '' || v === undefined || v === null) return undefined;
      if (typeof v === 'number') return v;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }),
});

export type OrgEditValues = z.infer<typeof orgEditSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build the tree from the flat list. Sort children by `sortOrder` asc, then
 * `name` (Korean collation) as tiebreaker.
 */
export function buildOrgTree(rows: AdminOrganization[]): OrganizationTreeNode[] {
  const byId = new Map<string, OrganizationTreeNode>();
  for (const o of rows) {
    byId.set(o.id, { ...o, children: [] });
  }
  const roots: OrganizationTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (xs: OrganizationTreeNode[]) => {
    xs.sort((a, b) =>
      a.sortOrder === b.sortOrder
        ? a.name.localeCompare(b.name, 'ko')
        : a.sortOrder - b.sortOrder,
    );
    xs.forEach((x) => sortRec(x.children));
  };
  sortRec(roots);
  return roots;
}

/** Collect ids of all descendants of `id` (excluding `id` itself). */
export function collectDescendantIds(
  rows: AdminOrganization[],
  id: string,
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const o of rows) {
    if (!o.parentId) continue;
    const arr = childrenByParent.get(o.parentId) ?? [];
    arr.push(o.id);
    childrenByParent.set(o.parentId, arr);
  }
  const out = new Set<string>();
  const stack: string[] = [...(childrenByParent.get(id) ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const c of childrenByParent.get(cur) ?? []) stack.push(c);
  }
  return out;
}

/** Build "동국씨엠 / 냉연사업부 / 냉연 1팀" breadcrumb for a target id. */
export function buildOrgPath(
  rows: AdminOrganization[],
  id: string,
): AdminOrganization[] {
  const byId = new Map(rows.map((o) => [o.id, o] as const));
  const trail: AdminOrganization[] = [];
  let cursor: string | null = id;
  // Defend against accidental cycles in stale data — cap to len(rows).
  let safety = rows.length + 1;
  while (cursor && safety-- > 0) {
    const node = byId.get(cursor);
    if (!node) break;
    trail.unshift(node);
    cursor = node.parentId;
  }
  return trail;
}

/** Find the siblings of `id` (same parent), sorted by sortOrder asc / name. */
export function siblingsOf(
  rows: AdminOrganization[],
  id: string,
): AdminOrganization[] {
  const target = rows.find((o) => o.id === id);
  if (!target) return [];
  return rows
    .filter((o) => o.parentId === target.parentId)
    .sort((a, b) =>
      a.sortOrder === b.sortOrder
        ? a.name.localeCompare(b.name, 'ko')
        : a.sortOrder - b.sortOrder,
    );
}

/** Find the direct children of `id`, sorted. */
export function childrenOf(
  rows: AdminOrganization[],
  id: string,
): AdminOrganization[] {
  return rows
    .filter((o) => o.parentId === id)
    .sort((a, b) =>
      a.sortOrder === b.sortOrder
        ? a.name.localeCompare(b.name, 'ko')
        : a.sortOrder - b.sortOrder,
    );
}
