// Drawing → ObjectEntity mapping.
//
// Number collisions are a known issue on the source side (4.3.5 — "도면번호
// 충돌 보정"). We surface them via the `numberCollisions` set; the loader
// renames the second+ occurrences with a `-MIG2`, `-MIG3`, ... suffix and
// records the collision in the migration report.

import type { TeamPlusDrawing } from '../source/types.js';
import type { TargetObject } from '../target/types.js';
import { clampSecurityLevel, mapObjectState } from './helpers.js';

export function transformObject(
  src: TeamPlusDrawing,
  ctx: {
    folderIdMap: ReadonlyMap<string, string>;
    classIdByCode: ReadonlyMap<string, string>;
    userIdMap: ReadonlyMap<string, string>;
    /** In/out — running set of `number` strings seen in this run. */
    seenNumbers: Set<string>;
    /** In/out — collisions detected, for the report. */
    numberCollisions: Set<string>;
  },
): TargetObject {
  const folderId = ctx.folderIdMap.get(src.folderExternalId);
  if (!folderId) {
    throw new Error(
      `transformObject: missing folder mapping for external id ${src.folderExternalId}`,
    );
  }
  const classId = ctx.classIdByCode.get(src.classCode);
  if (!classId) {
    throw new Error(
      `transformObject: missing class mapping for code ${src.classCode}`,
    );
  }
  const ownerId = ctx.userIdMap.get(src.ownerExternalId);
  if (!ownerId) {
    throw new Error(
      `transformObject: missing user mapping for external id ${src.ownerExternalId}`,
    );
  }

  let number = src.number;
  if (ctx.seenNumbers.has(number)) {
    ctx.numberCollisions.add(number);
    let i = 2;
    while (ctx.seenNumbers.has(`${number}-MIG${i}`)) i++;
    number = `${number}-MIG${i}`;
  }
  ctx.seenNumbers.add(number);

  return {
    externalId: src.externalId,
    number,
    name: src.name,
    description: src.description,
    folderId,
    classId,
    ownerId,
    securityLevel: clampSecurityLevel(src.securityLevel),
    state: mapObjectState(src.stateHint),
    createdAt: src.createdAt,
    updatedAt: src.updatedAt,
  };
}
