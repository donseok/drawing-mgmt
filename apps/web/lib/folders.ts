// Folder tree helpers shared by list/search routes.
//
// Previously each caller did `prisma.folder.findMany({ select: id, parentId })`
// — an unbounded full-table scan repeated on every list/facet request. Replaced
// with a parameterized recursive CTE so Postgres walks only the subtree under
// `rootId` using the existing `Folder_parentId_idx`.

import { prisma } from '@/lib/prisma';

/**
 * All folder ids reachable from `rootId` (inclusive). Walks the
 * `Folder.parentId` edge in Postgres via `WITH RECURSIVE`. `UNION` dedupes
 * against accidental cycles even though the schema disallows them.
 */
export async function collectFolderSubtreeIds(rootId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE descendants AS (
      SELECT id FROM "Folder" WHERE id = ${rootId}
      UNION
      SELECT f.id FROM "Folder" f
      INNER JOIN descendants d ON f."parentId" = d.id
    )
    SELECT id FROM descendants
  `;
  return rows.map((r) => r.id);
}
