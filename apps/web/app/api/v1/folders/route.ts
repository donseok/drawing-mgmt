// GET /api/v1/folders — full folder tree, filtered by VIEW_FOLDER permission.
//
// Response shape:
//   { data: FolderNode[] }
// where FolderNode = { id, name, folderCode, parentId, sortOrder,
//                      defaultClassId, children: FolderNode[] }
//
// Filtering rule: a folder is included if the user has VIEW_FOLDER on it.
// Ancestors of a visible folder are auto-included even if the user does not
// have explicit VIEW_FOLDER on them — otherwise descendants would be orphaned
// in the tree. (SUPER_ADMIN sees all.)

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { filterVisibleFolders } from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';

export interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
  folderCode: string;
  defaultClassId: string | null;
  sortOrder: number;
  objectCount: number;
  children: FolderNode[];
}

export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }

  const folders = await prisma.folder.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      parentId: true,
      name: true,
      folderCode: true,
      defaultClassId: true,
      sortOrder: true,
      _count: { select: { objects: { where: { deletedAt: null } } } },
    },
  });

  // Cast satisfies Prisma's User shape for permission helper.
  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);

  const allIds = folders.map((f) => f.id);
  const visible = await filterVisibleFolders({ user: fullUser, folderIds: allIds });

  // Auto-include ancestors of any visible folder so the tree stays connected.
  const byId = new Map(folders.map((f) => [f.id, f]));
  const expanded = new Set<string>(visible);
  for (const id of visible) {
    let cur = byId.get(id);
    while (cur?.parentId) {
      if (expanded.has(cur.parentId)) break;
      expanded.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }

  // Build tree from the expanded subset.
  const filtered = folders.filter((f) => expanded.has(f.id));
  const tree = buildTree(filtered);

  return ok(tree);
}

function buildTree(
  rows: ReadonlyArray<{
    id: string;
    parentId: string | null;
    name: string;
    folderCode: string;
    defaultClassId: string | null;
    sortOrder: number;
    _count: { objects: number };
  }>,
): FolderNode[] {
  const map = new Map<string, FolderNode>();
  for (const row of rows) {
    const { _count, ...rest } = row;
    map.set(row.id, { ...rest, objectCount: _count.objects, children: [] });
  }
  const roots: FolderNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

