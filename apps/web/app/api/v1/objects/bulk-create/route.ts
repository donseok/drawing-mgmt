// POST /api/v1/objects/bulk-create
//
// R16 — As-Is TeamPlus shipped this as a separate `.exe` (Excel template
// upload). We replace it with a paste-based dialog: the user dumps a CSV/TSV
// chunk (or types rows by hand) and the BE creates one ObjectEntity per row.
//
// Body shape:
//   {
//     rows: [{
//       folderCode: string,
//       classCode: string,
//       name: string,
//       number?: string,
//       securityLevel?: 1..5,
//       description?: string,
//     }, ...]
//   }
//
// Response (200, even on partial failure):
//   {
//     successes: [{ index, id, number }],
//     failures:  [{ index, code, message }]
//   }
//
// Why per-row creation (not a single transaction): a single bad row would
// roll back the whole batch and force the user to find + fix it before any
// good row lands. Per-row keeps the batch making progress while reporting
// exactly which rows failed and why — same UX shape as F4-03 bulk-delete.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, ObjectState } from '@prisma/client';
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

// `number` is required in the bulk path: autonumber is per-rule + needs a
// retry loop on unique violation (see single-row POST /api/v1/objects), and
// driving N rules through a single batch raises sequence-collision risk.
// The single-row dialog stays the canonical autonumber entry point; users
// who want manual control on import use this endpoint with explicit numbers.
const rowSchema = z.object({
  folderCode: z.string().min(1).max(32),
  classCode: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  number: z.string().min(1).max(64),
  securityLevel: z.number().int().min(1).max(5).optional(),
  description: z.string().max(2000).optional(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(MAX_BATCH),
});

interface SuccessRow {
  index: number;
  id: string;
  number: string;
}
interface FailureRow {
  index: number;
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
  const rows = parsed.data.rows;

  // Resolve unique folder codes + class codes in two queries instead of N.
  const folderCodes = Array.from(new Set(rows.map((r) => r.folderCode)));
  const classCodes = Array.from(new Set(rows.map((r) => r.classCode)));
  const [folders, classes, fullUser] = await Promise.all([
    prisma.folder.findMany({
      where: { folderCode: { in: folderCodes } },
      select: { id: true, folderCode: true },
    }),
    prisma.objectClass.findMany({
      where: { code: { in: classCodes } },
      select: { id: true, code: true },
    }),
    prisma.user.findUnique({ where: { id: user.id } }),
  ]);
  if (!fullUser) return error(ErrorCode.E_AUTH);

  const folderByCode = new Map(folders.map((f) => [f.folderCode, f.id]));
  const classByCode = new Map(classes.map((c) => [c.code, c.id]));

  // Permission check is per-folder; load all touched folders' perms once.
  const touchedFolderIds = Array.from(new Set(folders.map((f) => f.id)));
  const [pUser, perms] = await Promise.all([
    toPermissionUser(fullUser),
    loadFolderPermissions(touchedFolderIds),
  ]);

  const meta = extractRequestMeta(req);
  const successes: SuccessRow[] = [];
  const failures: FailureRow[] = [];

  // Process rows sequentially — a single batch creating 200 objects in
  // parallel could trample the autonumber sequence (each call increments).
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx]!;
    const folderId = folderByCode.get(row.folderCode);
    const classId = classByCode.get(row.classCode);
    if (!folderId) {
      failures.push({
        index: idx,
        code: ErrorCode.E_VALIDATION,
        message: `폴더코드 '${row.folderCode}'를 찾을 수 없습니다.`,
      });
      continue;
    }
    if (!classId) {
      failures.push({
        index: idx,
        code: ErrorCode.E_VALIDATION,
        message: `자료유형 '${row.classCode}'를 찾을 수 없습니다.`,
      });
      continue;
    }

    const decision = canAccess(
      pUser,
      {
        id: '',
        folderId,
        ownerId: user.id,
        securityLevel: row.securityLevel ?? 5,
      },
      perms,
      'EDIT',
    );
    if (!decision.allowed) {
      failures.push({
        index: idx,
        code: ErrorCode.E_FORBIDDEN,
        message: decision.reason ?? '권한이 없습니다.',
      });
      continue;
    }

    try {
      const created = await prisma.objectEntity.create({
        data: {
          number: row.number,
          name: row.name,
          description: row.description ?? null,
          folderId,
          classId,
          securityLevel: row.securityLevel ?? 5,
          state: ObjectState.NEW,
          ownerId: user.id,
          currentRevision: 0,
          currentVersion: new Prisma.Decimal('0.0'),
        },
        select: { id: true, number: true },
      });

      await logActivity({
        userId: user.id,
        action: 'OBJECT_CREATE',
        objectId: created.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { bulk: true, rowIndex: idx },
      });

      successes.push({ index: idx, id: created.id, number: created.number });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        failures.push({
          index: idx,
          code: ErrorCode.E_VALIDATION,
          message: '이미 존재하는 도면번호입니다.',
        });
        continue;
      }
      failures.push({
        index: idx,
        code: ErrorCode.E_INTERNAL,
        message: e instanceof Error ? e.message : '알 수 없는 오류',
      });
    }
  }

  return ok({ successes, failures });
}
