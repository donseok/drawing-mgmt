// Folder mapping: TeamPlusFolder → TargetFolder.
//
// drawing-mgmt requires `folderCode` uniqueness across the entire system,
// so we run every code through `normalizeFolderCode` and dedup with a
// short numeric suffix on the rare collision. The chosen code is recorded
// in `assignedCodes` so reruns produce the same shape (idempotency).

import type { TeamPlusFolder } from '../source/types.js';
import type { TargetFolder } from '../target/types.js';
import { normalizeFolderCode } from './helpers.js';

export function transformFolder(
  src: TeamPlusFolder,
  parentIdMap: ReadonlyMap<string, string>,
  /**
   * In/out: the running set of folder codes already taken in this run.
   * The function mutates it (records the code it picked). Pass the same
   * Map across the whole run.
   */
  assignedCodes: Set<string>,
): TargetFolder {
  let code = normalizeFolderCode(src.pathCode);
  if (assignedCodes.has(code)) {
    let i = 2;
    while (assignedCodes.has(`${code}_${i}`)) i++;
    code = `${code}_${i}`;
  }
  assignedCodes.add(code);

  const parentId = src.parentExternalId
    ? parentIdMap.get(src.parentExternalId) ?? null
    : null;

  return {
    externalId: src.externalId,
    name: src.name,
    folderCode: code,
    parentId,
    sortOrder: src.sortOrder,
  };
}
