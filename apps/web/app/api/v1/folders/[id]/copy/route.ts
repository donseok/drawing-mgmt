// POST /api/v1/folders/:id/copy
//
// Body: { parentId: string | null, folderCode: string, name?: string,
//         includeChildren?: boolean }
//
// Copies a folder (and optionally its sub-folder tree) under `parentId`. The
// new root takes the supplied `folderCode` (must be globally unique) and
// `name` (defaults to `<source.name> 복사`). Sub-folder codes are auto-derived
// by appending `-COPY` / `-COPY2` / ... so the copy never collides with an
// existing tree.
//
// What does *not* copy: the folder's objects, permissions, and any existing
// pins. Object copy is a much bigger operation (storage + permissions
// re-evaluation) and lives in its own endpoint when it ships.
//
// ADMIN/SUPER_ADMIN only.
//
// Owned by BE (R15).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { ok, error, ErrorCode } from '@/lib/api-response';
import { extractRequestMeta, logActivity } from '@/lib/audit';
import { withApi } from '@/lib/api-helpers';

function isAdmin(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

const bodySchema = z.object({
  parentId: z.string().min(1).nullable(),
  folderCode: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/, '폴더코드는 영문 대문자/숫자/_-만 허용합니다.'),
  name: z.string().min(1).max(100).optional(),
  /** Default true — copying a leaf folder is the same as ignoring this flag. */
  includeChildren: z.boolean().optional(),
});

export const POST = withApi<{ params: { id: string } }>(
  { rateLimit: 'api' },
  async (req, { params }) => {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
  }
  if (!isAdmin(user.role)) {
    return error(ErrorCode.E_FORBIDDEN, '폴더 복사 권한이 없습니다.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(ErrorCode.E_VALIDATION, '본문이 유효한 JSON이 아닙니다.');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(
      ErrorCode.E_VALIDATION,
      undefined,
      undefined,
      parsed.error.flatten(),
    );
  }
  const dto = parsed.data;
  const includeChildren = dto.includeChildren ?? true;

  const source = await prisma.folder.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, folderCode: true, defaultClassId: true },
  });
  if (!source) return error(ErrorCode.E_NOT_FOUND);

  // Verify the destination parent exists when given. Cycle is impossible
  // because we're creating brand-new folder ids — the new tree has no edges
  // back into the source tree.
  if (dto.parentId) {
    const dest = await prisma.folder.findUnique({
      where: { id: dto.parentId },
      select: { id: true },
    });
    if (!dest) {
      return error(ErrorCode.E_VALIDATION, '대상 상위 폴더를 찾을 수 없습니다.');
    }
  }

  // Build descendant subtree once.
  const descendants = includeChildren
    ? await loadSubtree(source.id)
    : { nodes: [], edges: [] };

  // Pre-load only folderCodes that could collide with this copy operation:
  //   - the user-supplied root code (exact match),
  //   - the `<base>-COPY[N]` family for the source root and every descendant.
  // Previously this loaded the entire Folder table.
  const codePrefixes = Array.from(
    new Set([source.folderCode, ...descendants.nodes.map((n) => n.folderCode)].map((c) => `${c}-COPY`)),
  );
  const existingCodes = new Set<string>();
  const collisionRows = await prisma.folder.findMany({
    where: {
      OR: [
        { folderCode: dto.folderCode },
        ...codePrefixes.map((p) => ({ folderCode: { startsWith: p } })),
      ],
    },
    select: { folderCode: true },
  });
  for (const r of collisionRows) existingCodes.add(r.folderCode);

  type CreatedRow = { oldId: string; newId: string };
  const created: CreatedRow[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Create the new root.
      if (existingCodes.has(dto.folderCode)) {
        throw new CopyError(
          ErrorCode.E_VALIDATION,
          '이미 사용 중인 폴더코드입니다.',
        );
      }
      const newRoot = await tx.folder.create({
        data: {
          name: dto.name ?? `${source.name} 복사`,
          folderCode: dto.folderCode,
          parentId: dto.parentId,
          defaultClassId: source.defaultClassId,
        },
      });
      created.push({ oldId: source.id, newId: newRoot.id });
      existingCodes.add(dto.folderCode);

      // 2. Recursively create descendants in BFS order (parents before
      //    children) so we always have the new parent id ready.
      // Sort by depth via a topological walk: nodes with parentId already
      // mapped become eligible.
      const remaining = [...descendants.nodes];
      const idMap = new Map<string, string>([[source.id, newRoot.id]]);
      // Loop until no progress — a stuck remainder means the subtree query
      // returned an inconsistent set (shouldn't happen, but bail safely).
      let progress = true;
      while (remaining.length > 0 && progress) {
        progress = false;
        for (let i = remaining.length - 1; i >= 0; i--) {
          const node = remaining[i]!;
          const newParentId = node.parentId ? idMap.get(node.parentId) : null;
          if (newParentId === undefined) continue; // parent not yet copied
          const code = nextFreeCode(node.folderCode, existingCodes);
          existingCodes.add(code);
          const newRow = await tx.folder.create({
            data: {
              name: node.name,
              folderCode: code,
              parentId: newParentId,
              defaultClassId: node.defaultClassId,
            },
          });
          idMap.set(node.id, newRow.id);
          created.push({ oldId: node.id, newId: newRow.id });
          remaining.splice(i, 1);
          progress = true;
        }
      }
      if (remaining.length > 0) {
        throw new CopyError(
          ErrorCode.E_INTERNAL,
          '하위 폴더 복사 중 의존 관계 해결에 실패했습니다.',
        );
      }
    });
  } catch (e) {
    if (e instanceof CopyError) {
      return error(e.code, e.message);
    }
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return error(ErrorCode.E_VALIDATION, '이미 사용 중인 폴더코드입니다.');
    }
    throw e;
  }

  const meta = extractRequestMeta(req);
  await logActivity({
    userId: user.id,
    action: 'FOLDER_COPY',
    objectId: null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      sourceId: source.id,
      newId: created[0]!.newId,
      copied: created.length,
    },
  });

  return ok(
    {
      sourceId: source.id,
      newId: created[0]!.newId,
      copied: created.length,
    },
    undefined,
    { status: 201 },
  );
  },
);

async function loadSubtree(rootId: string): Promise<{
  nodes: Array<{
    id: string;
    parentId: string | null;
    name: string;
    folderCode: string;
    defaultClassId: string | null;
  }>;
  edges: Array<[string, string]>;
}> {
  // Fetch all folders, then walk the parent edges starting from rootId.
  const all = await prisma.folder.findMany({
    select: {
      id: true,
      parentId: true,
      name: true,
      folderCode: true,
      defaultClassId: true,
    },
  });
  const childrenByParent = new Map<string, typeof all>();
  for (const f of all) {
    if (!f.parentId) continue;
    const list = childrenByParent.get(f.parentId) ?? [];
    list.push(f);
    childrenByParent.set(f.parentId, list);
  }
  const out: typeof all = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const kids = childrenByParent.get(id) ?? [];
    for (const k of kids) {
      out.push(k);
      stack.push(k.id);
    }
  }
  return { nodes: out, edges: [] };
}

function nextFreeCode(base: string, used: Set<string>): string {
  // Append `-COPY`, `-COPY2`, ... until something free is found.
  if (!used.has(`${base}-COPY`)) return `${base}-COPY`;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-COPY${i}`;
    if (!used.has(candidate)) return candidate;
  }
  // 1000 collisions on a single base would be pathological; use a uuid suffix.
  return `${base}-COPY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

class CopyError extends Error {
  constructor(
    public readonly code: (typeof ErrorCode)[keyof typeof ErrorCode],
    message: string,
  ) {
    super(message);
    this.name = 'CopyError';
  }
}
