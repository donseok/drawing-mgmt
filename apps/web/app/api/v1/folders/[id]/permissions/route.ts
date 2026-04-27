// U-5 — folder permission matrix endpoints (R28).
//
// GET  /api/v1/folders/:id/permissions
//   List every FolderPermission row for the folder, with a friendly
//   `principalLabel`/`principalSublabel` so the FE matrix can render rows
//   without N+1 lookups. Soft-deleted users / missing principals surface as
//   "(삭제됨)" so admins can find and prune orphan rows.
//
// PUT  /api/v1/folders/:id/permissions
//   Full-replace the permission set in one transaction (delete-all +
//   insert-many). Validates that every `principalId` actually exists in
//   the right table and that no `(type, id)` pair is duplicated.
//   Records a single ActivityLog `FOLDER_PERMISSION_UPDATE` row with
//   before/after counts.
//
// Authorization: SUPER_ADMIN or ADMIN. Owner: backend (R28).
//
// Contract reference: `_workspace/api_contract.md` §3.1, §3.2.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, type PrincipalType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

// ── Response shape ────────────────────────────────────────────────────────
//
// We export the row type so a future shared package can pick it up.
// (Contract §3 — frontend is wired off this exact shape.)

export interface FolderPermissionRow {
  id: string;
  principalType: PrincipalType;
  principalId: string;
  principalLabel: string;
  principalSublabel: string | null;
  viewFolder: boolean;
  editFolder: boolean;
  viewObject: boolean;
  editObject: boolean;
  deleteObject: boolean;
  approveObject: boolean;
  download: boolean;
  print: boolean;
}

export interface FolderPermissionsResponse {
  folder: {
    id: string;
    name: string;
    folderCode: string;
    parentId: string | null;
  };
}

// ── PUT body schema ───────────────────────────────────────────────────────

const principalTypeSchema = z.enum(['USER', 'ORG', 'GROUP']);

const permissionRowSchema = z.object({
  principalType: principalTypeSchema,
  principalId: z.string().min(1).max(64),
  viewFolder: z.boolean(),
  editFolder: z.boolean(),
  viewObject: z.boolean(),
  editObject: z.boolean(),
  deleteObject: z.boolean(),
  approveObject: z.boolean(),
  download: z.boolean(),
  print: z.boolean(),
});

const putBodySchema = z.object({
  permissions: z.array(permissionRowSchema).min(0).max(500),
});

// ── GET handler ───────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) return error(ErrorCode.E_FORBIDDEN);

  const folder = await prisma.folder.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, folderCode: true, parentId: true },
  });
  if (!folder) return error(ErrorCode.E_NOT_FOUND);

  const rows = await prisma.folderPermission.findMany({
    where: { folderId: folder.id },
    orderBy: [{ principalType: 'asc' }, { id: 'asc' }],
  });

  const labels = await loadPrincipalLabels(rows);
  const permissions: FolderPermissionRow[] = rows.map((r) =>
    toRow(r, labels),
  );

  return ok({ folder } satisfies FolderPermissionsResponse, { permissions });
}

// ── PUT handler (wrapped with CSRF + rate limit) ──────────────────────────

export const PUT = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
    let user;
    try {
      user = await requireUser();
    } catch (err) {
      if (err instanceof Response) return err as NextResponse;
      throw err;
    }
    if (!isAdmin(user.role)) return error(ErrorCode.E_FORBIDDEN);

    const folder = await prisma.folder.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, folderCode: true, parentId: true },
    });
    if (!folder) return error(ErrorCode.E_NOT_FOUND);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
    }
    const parsed = putBodySchema.safeParse(body);
    if (!parsed.success) {
      return error(
        ErrorCode.E_VALIDATION,
        undefined,
        undefined,
        parsed.error.flatten(),
      );
    }

    // Drop rows where every bit is false — they'd be useless DB clutter.
    // Contract §3.2 — "8 bits 모두 false인 row가 있으면 무시(no-op)".
    const incoming = parsed.data.permissions.filter(hasAnyBitSet);

    // Duplicate (type, id) check — `@@unique` would catch this on insert,
    // but we want a clean E_VALIDATION with a fieldError pointing at the
    // bad row instead of a Prisma P2002.
    const dupIndex = findDuplicate(incoming);
    if (dupIndex !== null) {
      return error(
        ErrorCode.E_VALIDATION,
        '같은 대상에 권한이 중복 지정되어 있습니다.',
        undefined,
        { fieldErrors: { [`permissions.${dupIndex}`]: ['중복된 대상'] } },
      );
    }

    // Existence check — bulk SELECT per type so we don't fire N queries.
    const missingIndex = await findMissingPrincipal(incoming);
    if (missingIndex !== null) {
      return error(
        ErrorCode.E_VALIDATION,
        '존재하지 않는 대상이 포함되어 있습니다.',
        undefined,
        {
          fieldErrors: {
            [`permissions.${missingIndex}`]: ['존재하지 않는 대상'],
          },
        },
      );
    }

    const beforeCount = await prisma.folderPermission.count({
      where: { folderId: folder.id },
    });

    // Full replace inside a transaction. We delete-then-insert (rather than
    // upsert) because the matrix UI is "snapshot-and-save" and any row not
    // in the new payload is implicitly being revoked.
    await prisma.$transaction([
      prisma.folderPermission.deleteMany({ where: { folderId: folder.id } }),
      ...(incoming.length > 0
        ? [
            prisma.folderPermission.createMany({
              data: incoming.map((p) => ({
                folderId: folder.id,
                principalType: p.principalType,
                principalId: p.principalId,
                viewFolder: p.viewFolder,
                editFolder: p.editFolder,
                viewObject: p.viewObject,
                editObject: p.editObject,
                deleteObject: p.deleteObject,
                approveObject: p.approveObject,
                download: p.download,
                print: p.print,
              })),
            }),
          ]
        : []),
    ]);

    const meta = extractRequestMeta(req);
    await logActivity({
      userId: user.id,
      action: 'FOLDER_PERMISSION_UPDATE',
      objectId: null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        folderId: folder.id,
        before: beforeCount,
        after: incoming.length,
      },
    });

    // Re-read the canonical state (cheap — single folder) and return the
    // same shape as GET so the FE can drop it straight into the cache.
    const rows = await prisma.folderPermission.findMany({
      where: { folderId: folder.id },
      orderBy: [{ principalType: 'asc' }, { id: 'asc' }],
    });
    const labels = await loadPrincipalLabels(rows);
    const permissions: FolderPermissionRow[] = rows.map((r) => toRow(r, labels));

    return ok({ folder } satisfies FolderPermissionsResponse, { permissions });
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────

interface PrincipalLabelMap {
  users: Map<string, { fullName: string; username: string; email: string | null; deletedAt: Date | null }>;
  groups: Map<string, { name: string }>;
  orgs: Map<string, { name: string }>;
}

async function loadPrincipalLabels(
  rows: Array<{ principalType: PrincipalType; principalId: string }>,
): Promise<PrincipalLabelMap> {
  const userIds: string[] = [];
  const groupIds: string[] = [];
  const orgIds: string[] = [];
  for (const r of rows) {
    if (r.principalType === 'USER') userIds.push(r.principalId);
    else if (r.principalType === 'GROUP') groupIds.push(r.principalId);
    else if (r.principalType === 'ORG') orgIds.push(r.principalId);
  }

  const [users, groups, orgs] = await Promise.all([
    userIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            deletedAt: true,
          },
        })
      : Promise.resolve([] as Array<{
          id: string;
          fullName: string;
          username: string;
          email: string | null;
          deletedAt: Date | null;
        }>),
    groupIds.length > 0
      ? prisma.group.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    orgIds.length > 0
      ? prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);

  return {
    users: new Map(users.map((u) => [u.id, u])),
    groups: new Map(groups.map((g) => [g.id, { name: g.name }])),
    orgs: new Map(orgs.map((o) => [o.id, { name: o.name }])),
  };
}

function toRow(
  r: {
    id: string;
    principalType: PrincipalType;
    principalId: string;
    viewFolder: boolean;
    editFolder: boolean;
    viewObject: boolean;
    editObject: boolean;
    deleteObject: boolean;
    approveObject: boolean;
    download: boolean;
    print: boolean;
  },
  labels: PrincipalLabelMap,
): FolderPermissionRow {
  let principalLabel = '(삭제됨)';
  let principalSublabel: string | null = r.principalId;

  if (r.principalType === 'USER') {
    const u = labels.users.get(r.principalId);
    if (u && !u.deletedAt) {
      principalLabel = u.fullName || u.username;
      principalSublabel = u.email ?? null;
    }
  } else if (r.principalType === 'GROUP') {
    const g = labels.groups.get(r.principalId);
    if (g) {
      principalLabel = g.name;
      principalSublabel = null;
    }
  } else if (r.principalType === 'ORG') {
    const o = labels.orgs.get(r.principalId);
    if (o) {
      principalLabel = o.name;
      principalSublabel = null;
    }
  }

  return {
    id: r.id,
    principalType: r.principalType,
    principalId: r.principalId,
    principalLabel,
    principalSublabel,
    viewFolder: r.viewFolder,
    editFolder: r.editFolder,
    viewObject: r.viewObject,
    editObject: r.editObject,
    deleteObject: r.deleteObject,
    approveObject: r.approveObject,
    download: r.download,
    print: r.print,
  };
}

function hasAnyBitSet(p: z.infer<typeof permissionRowSchema>): boolean {
  return (
    p.viewFolder ||
    p.editFolder ||
    p.viewObject ||
    p.editObject ||
    p.deleteObject ||
    p.approveObject ||
    p.download ||
    p.print
  );
}

function findDuplicate(
  rows: Array<z.infer<typeof permissionRowSchema>>,
): number | null {
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const key = `${r.principalType}:${r.principalId}`;
    if (seen.has(key)) return i;
    seen.add(key);
  }
  return null;
}

/**
 * Verify every principalId exists. Returns the index of the first row whose
 * id does NOT exist in its corresponding table. We bulk-load per type with a
 * single IN query each — three round trips total, regardless of row count.
 */
async function findMissingPrincipal(
  rows: Array<z.infer<typeof permissionRowSchema>>,
): Promise<number | null> {
  if (rows.length === 0) return null;

  const userIds = new Set<string>();
  const groupIds = new Set<string>();
  const orgIds = new Set<string>();
  for (const r of rows) {
    if (r.principalType === 'USER') userIds.add(r.principalId);
    else if (r.principalType === 'GROUP') groupIds.add(r.principalId);
    else orgIds.add(r.principalId);
  }

  const [foundUsers, foundGroups, foundOrgs] = await Promise.all([
    userIds.size > 0
      ? prisma.user.findMany({
          where: { id: { in: [...userIds] }, deletedAt: null },
          select: { id: true },
        })
      : Promise.resolve([] as Array<{ id: string }>),
    groupIds.size > 0
      ? prisma.group.findMany({
          where: { id: { in: [...groupIds] } },
          select: { id: true },
        })
      : Promise.resolve([] as Array<{ id: string }>),
    orgIds.size > 0
      ? prisma.organization.findMany({
          where: { id: { in: [...orgIds] } },
          select: { id: true },
        })
      : Promise.resolve([] as Array<{ id: string }>),
  ]);

  const u = new Set(foundUsers.map((x) => x.id));
  const g = new Set(foundGroups.map((x) => x.id));
  const o = new Set(foundOrgs.map((x) => x.id));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.principalType === 'USER' && !u.has(r.principalId)) return i;
    if (r.principalType === 'GROUP' && !g.has(r.principalId)) return i;
    if (r.principalType === 'ORG' && !o.has(r.principalId)) return i;
  }
  return null;
}

// Silence unused-import warning when Prisma's type narrowing isn't used directly.
void Prisma;
