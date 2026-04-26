// /api/v1/folders
//   GET   — full folder tree, filtered by VIEW_FOLDER permission.
//   POST  — create a new folder (ADMIN/SUPER_ADMIN only).
//
// Response shape (GET):
//   { data: FolderNode[] }
// where FolderNode = { id, name, folderCode, parentId, sortOrder,
//                      defaultClassId, children: FolderNode[] }
//
// Filtering rule: a folder is included if the user has VIEW_FOLDER on it.
// Ancestors of a visible folder are auto-included even if the user does not
// have explicit VIEW_FOLDER on them — otherwise descendants would be orphaned
// in the tree. (SUPER_ADMIN sees all.)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { filterVisibleFolders } from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  /** Uppercased + dash-only token used for autonumbering. Must be unique. */
  folderCode: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/, '폴더코드는 영문 대문자/숫자/_-만 허용합니다.'),
  parentId: z.string().min(1).nullable().optional(),
  defaultClassId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

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

export async function POST(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) {
    return error(ErrorCode.E_FORBIDDEN, '폴더 생성 권한이 없습니다.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const dto = parsed.data;

  // Verify parent exists when supplied — better error than the foreign-key
  // explosion we'd get from Prisma alone.
  if (dto.parentId) {
    const parent = await prisma.folder.findUnique({
      where: { id: dto.parentId },
      select: { id: true },
    });
    if (!parent) {
      return error(ErrorCode.E_VALIDATION, '상위 폴더를 찾을 수 없습니다.');
    }
  }

  let folder;
  try {
    folder = await prisma.folder.create({
      data: {
        name: dto.name,
        folderCode: dto.folderCode,
        parentId: dto.parentId ?? null,
        defaultClassId: dto.defaultClassId ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return error(
        ErrorCode.E_VALIDATION,
        '이미 사용 중인 폴더코드입니다.',
      );
    }
    throw e;
  }

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'FOLDER_CREATE',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { folderId: folder.id, name: folder.name, code: folder.folderCode },
  });

  return ok(folder, undefined, { status: 201 });
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

