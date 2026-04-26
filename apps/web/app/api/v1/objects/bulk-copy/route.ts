// POST /api/v1/objects/bulk-copy
//
// R17 — copy N objects to a new folder. Each copy is a fresh ObjectEntity
// with the same name/description/securityLevel/attributes but a derived
// `number` (`<original>-COPY` / `-COPY2` / ...) so we never collide with
// the unique constraint. Revisions/versions/attachments do NOT copy in
// this phase — duplicating storage + checksum work belongs in a later card
// when the user actually needs side-by-side history.
//
// Body:
//   { ids: string[] (1..200), targetFolderId: string }
//
// Response (200, partial allowed):
//   {
//     successes: [{ srcId, newId, newNumber }],
//     failures:  [{ id, code, message }]
//   }
//
// Owned by BE (R17).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ObjectState, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import {
  canAccess,
  loadFolderPermissions,
  toPermissionUser,
} from '@/lib/permissions';
import { ok, error, ErrorCode } from '@/lib/api-response';
import type { ApiErrorCode } from '@/lib/api-errors';
import { extractRequestMeta, logActivity } from '@/lib/audit';

const MAX_BATCH = 200;

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(MAX_BATCH),
  targetFolderId: z.string().min(1),
});

interface SuccessRow {
  srcId: string;
  newId: string;
  newNumber: string;
}
interface FailureRow {
  id: string;
  code: ApiErrorCode;
  message: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    throw err;
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
  const { ids, targetFolderId } = parsed.data;
  const uniqueIds = Array.from(new Set(ids));

  const target = await prisma.folder.findUnique({
    where: { id: targetFolderId },
    select: { id: true },
  });
  if (!target) {
    return error(ErrorCode.E_VALIDATION, '대상 폴더를 찾을 수 없습니다.');
  }

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fullUser) return error(ErrorCode.E_AUTH);
  const pUser = await toPermissionUser(fullUser);

  const objs = await prisma.objectEntity.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      number: true,
      name: true,
      description: true,
      folderId: true,
      classId: true,
      ownerId: true,
      securityLevel: true,
      attributes: { select: { attributeId: true, value: true } },
    },
  });
  const byId = new Map(objs.map((o) => [o.id, o]));

  const folderIds = Array.from(
    new Set([targetFolderId, ...objs.map((o) => o.folderId)]),
  );
  const perms = await loadFolderPermissions(folderIds);

  const destDecision = canAccess(
    pUser,
    { id: '', folderId: targetFolderId, ownerId: user.id, securityLevel: 5 },
    perms,
    'EDIT',
  );
  if (!destDecision.allowed) {
    return error(
      ErrorCode.E_FORBIDDEN,
      destDecision.reason ?? '대상 폴더에 쓰기 권한이 없습니다.',
    );
  }

  // Pre-load existing numbers so we can derive collision-free copy numbers
  // without per-row catch loops. The BE still catches P2002 as a safety net
  // in case another writer slips a number in mid-batch.
  const existingNumbers = new Set<string>(
    (
      await prisma.objectEntity.findMany({ select: { number: true } })
    ).map((r) => r.number),
  );

  const meta = extractRequestMeta(req);
  const successes: SuccessRow[] = [];
  const failures: FailureRow[] = [];

  for (const id of uniqueIds) {
    const src = byId.get(id);
    if (!src) {
      failures.push({
        id,
        code: ErrorCode.E_NOT_FOUND,
        message: '대상 자료를 찾을 수 없습니다.',
      });
      continue;
    }
    const decision = canAccess(pUser, src, perms, 'VIEW');
    if (!decision.allowed) {
      failures.push({
        id: src.id,
        code: ErrorCode.E_FORBIDDEN,
        message: decision.reason ?? '권한이 없습니다.',
      });
      continue;
    }

    const newNumber = nextFreeNumber(src.number, existingNumbers);
    existingNumbers.add(newNumber);

    try {
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.objectEntity.create({
          data: {
            number: newNumber,
            name: src.name,
            description: src.description,
            folderId: targetFolderId,
            classId: src.classId,
            securityLevel: src.securityLevel,
            state: ObjectState.NEW,
            ownerId: user.id, // copies belong to the actor, not the original owner
            currentRevision: 0,
            currentVersion: new Prisma.Decimal('0.0'),
          },
        });
        if (src.attributes.length > 0) {
          await tx.objectAttributeValue.createMany({
            data: src.attributes.map((a) => ({
              objectId: row.id,
              attributeId: a.attributeId,
              value: a.value,
            })),
          });
        }
        return row;
      });
      await logActivity({
        userId: user.id,
        action: 'OBJECT_COPY',
        objectId: created.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          srcId: src.id,
          srcNumber: src.number,
          toFolderId: targetFolderId,
          bulk: true,
        },
      });
      successes.push({
        srcId: src.id,
        newId: created.id,
        newNumber: created.number,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        failures.push({
          id: src.id,
          code: ErrorCode.E_VALIDATION,
          message: '도면번호 충돌 (다른 사용자가 동일 번호를 선점함).',
        });
        continue;
      }
      failures.push({
        id: src.id,
        code: ErrorCode.E_INTERNAL,
        message: e instanceof Error ? e.message : '알 수 없는 오류',
      });
    }
  }

  return ok({ successes, failures });
}

function nextFreeNumber(base: string, used: Set<string>): string {
  const candidate = `${base}-COPY`;
  if (!used.has(candidate)) return candidate;
  for (let i = 2; i < 1000; i++) {
    const c = `${base}-COPY${i}`;
    if (!used.has(c)) return c;
  }
  // Pathological tail — append a uuid suffix to guarantee uniqueness.
  return `${base}-COPY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
